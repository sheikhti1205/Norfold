-- Audit 2026-11-15 (P1): close the chat-file lifecycle gap while the
-- bucket is still empty.
--
-- WHAT WAS MISSING.
--   1. `20261112170000_chat_file_transport.sql` shipped a private bucket with a
--      20 MB PER-OBJECT ceiling and nothing else: one account could hold an
--      unbounded number of 20 MB objects. The chat-media lane has had a 100 MB
--      logical budget from the start; the file lane had no cumulative ceiling
--      at all, so the per-file limit was the only limit.
--   2. Deleting a file message clears the message row body but never removed
--      the Storage object, and no worker swept the orphans. The only removal
--      path was the client best-effort delete after a failed send.
--
-- WHAT THIS ADDS.
--   1. `findback_chat_file_bytes_used` - the authoritative per-account total of
--      the file lane, read from `storage.objects` metadata.
--   2. `findback_chat_file_budget_ok` - used + incoming <= 104857600.
--   3. The SAME insert policy re-created with the budget predicate added. The
--      participant prefix check is carried over unchanged, so a refusal is
--      never looser than before, only stricter.
--   4. `findback_chat_file_marker_present` - the service-only probe the
--      `cleanup-chat-files` worker uses to ask whether any live message still
--      names an object.
--
-- THE BUDGET IS 100 MB PER ACCOUNT (104857600 bytes), cumulative across every
-- conversation that account sent a file in. It is enforced by the Storage
-- insert policy, so a client that skips every UI check is still refused by the
-- database. A refused upload surfaces to the client as a Storage 4xx whose
-- message names the row-level security policy; the client maps that to
-- "Your file space is full (100 MB sent across chats). Remove a file to send more."
--
-- WHY THE PREDICATE IS CLIENT-EXECUTABLE. A Storage policy is evaluated with the
-- privileges of the caller (`authenticated`), so a SECURITY DEFINER predicate it
-- calls must be granted to that role. The predicate therefore refuses any user
-- id other than `auth.uid()`, which keeps the answer scoped to the caller and
-- makes the grant a boolean self-check, not an account probe.
--
-- WHY object_name IS NOT DECODED HERE. The message body carries
-- `norfold-file:v1:<base64url JSON>`; PostgreSQL can decode base64 but cannot
-- validate it without aborting the query on one malformed body. The sweep builds
-- the byte-aligned marker fragment in TypeScript with the same encoder the client
-- uses and asks this probe; encoding stays in one language.
--
-- NO DYNAMIC DDL: no DO block, no EXECUTE, no format(). Migration parity pins
-- dynamic statements, and a purely static migration stays reviewable.
--
-- GUARDS: supabase/tests/chat_file_budget_policy.test.mjs (static, no engine).
begin;

-- ---------------------------------------------------------------------------
-- 1. The authoritative per-account total, in bytes.
-- ---------------------------------------------------------------------------
create or replace function public.findback_chat_file_bytes_used(p_user_id text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    sum(
      case
        -- A stored object always carries a numeric size (the insert policy
        -- below refuses anything else). An object without one cannot be
        -- measured, so it is charged just over the whole budget: fail closed
        -- instead of undercounting the account.
        when (o.metadata ->> 'size') ~ '^[0-9]{1,12}$'
          then (o.metadata ->> 'size')::bigint
        else 104857601
      end
    ),
    0
  )::bigint
  from storage.objects o
  where o.bucket_id = 'findback-chat-files'
    and starts_with(o.name, 'files/' || p_user_id || '/')
$$;

revoke all on function public.findback_chat_file_bytes_used(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The budget predicate the insert policy enforces.
--
-- `p_incoming` is the size the caller is trying to store. A null or negative
-- value is refused, and so is any id that is not the caller: a direct call can
-- only ask about its own account.
-- ---------------------------------------------------------------------------
create or replace function public.findback_chat_file_budget_ok(
  p_user_id text,
  p_incoming bigint
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    p_incoming >= 0
    and p_incoming <= 104857600
    and p_user_id = auth.uid()::text
    and public.findback_chat_file_bytes_used(p_user_id) + p_incoming <= 104857600,
    false
  )
$$;

revoke all on function public.findback_chat_file_budget_ok(text, bigint)
  from public, anon, authenticated;
-- The Storage insert policy runs as `authenticated`; without this grant every
-- file upload would fail with a permission error instead of a budget refusal.
grant execute on function public.findback_chat_file_budget_ok(text, bigint)
  to authenticated;

comment on function public.findback_chat_file_budget_ok(text, bigint)
  is $cmt$Cumulative chat-file budget predicate: true only when the caller is the account being charged and used + incoming stays within 104857600 bytes (100 MB). The Storage insert policy on findback-chat-files calls this with the row metadata size, so an over-budget upload is refused as a Storage 4xx. A malformed or absent size is passed as null and refused.$cmt$;

-- ---------------------------------------------------------------------------
-- 3. The sweep probe: does any live message still name this object?
--
-- `position()` rather than LIKE: the fragment is base64url, whose alphabet
-- contains `_`, and LIKE reads `_` as a single-character wildcard. A wildcard
-- could only make the match looser (keeping an orphan), never delete a live
-- file, but the exact substring test is just as cheap and has no such edge.
--
-- No length check is skipped: a fragment shorter than 16 characters is refused
-- rather than matched, because an empty or one-character marker would match
-- every message and a malformed marker must not silently read as "unreferenced"
-- (the worker deletes on false).
-- ---------------------------------------------------------------------------
create or replace function public.findback_chat_file_marker_present(p_marker text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(length(p_marker) >= 16, false)
    and exists (
      select 1
      from public.chat_messages m
      where position(p_marker in m.body) > 0
    )
$$;

revoke all on function public.findback_chat_file_marker_present(text)
  from public, anon, authenticated;
grant execute on function public.findback_chat_file_marker_present(text)
  to service_role;

comment on function public.findback_chat_file_marker_present(text)
  is $cmt$Service-only probe for the cleanup-chat-files sweep: true when any chat_messages.body still contains this exact marker fragment. The fragment is built by the worker with the client marker encoder (see apps/mobile/src/services/messaging/files.ts), so encoding lives in one language. Revoked from every client role.$cmt$;

-- ---------------------------------------------------------------------------
-- 4. The insert policy, with the budget added and the participant check kept.
--
-- `metadata` is the row being inserted, so the incoming size is the object's own
-- declared size, not something the caller sends separately. The CASE both
-- validates the text and yields null for anything that is not 1-12 digits, so a
-- malformed size fails the check instead of raising a cast error inside the
-- policy.
-- ---------------------------------------------------------------------------
drop policy if exists findback_chat_files_insert_own on storage.objects;
create policy findback_chat_files_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'findback-chat-files'
    and (storage.foldername(name))[1] = 'files'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.findback_chat_file_participant((storage.foldername(name))[3])
    and public.findback_chat_file_budget_ok(
      (select auth.uid())::text,
      case
        when (metadata ->> 'size') ~ '^[0-9]{1,12}$'
          then (metadata ->> 'size')::bigint
      end
    )
  );

commit;
