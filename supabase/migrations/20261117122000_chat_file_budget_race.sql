-- Audit 2026-11-15 (P1 follow-up): the chat-file budget predicate was
-- racy by construction.
--
-- `findback_chat_file_budget_ok` was `stable` and summed committed objects.
-- Two uploads for the same account in different transactions both read the same
-- pre-insert total, both passed `used + incoming <= 100 MB`, and both landed:
-- 100 MB of committed bytes plus two 20 MB files is 140 MB, not a refusal.
--
-- The fix is serialization, not a cached counter. A counter incremented inside
-- the same policy has no idempotency key: Storage probes the insert policy at
-- least twice per upload (pre-upload and completion, see
-- 20261115150000_chat_file_budget_insert_metadata), so a plain `used = used +
-- incoming` would charge one file twice and a rejected or abandoned probe would
-- leak its bytes forever. A trigger has the mirror-image race: both rows are
-- visible to each other only after both checks passed.
--
-- Every probe now takes a transaction-scoped advisory lock keyed on the account
-- and then re-reads the committed total. The second transaction blocks until the
-- first commits, and its sum is a fresh statement snapshot taken after the wait,
-- so it sees the row it was waiting for. The function stays a pure predicate:
-- the policy can be evaluated any number of times without side effects.
--
-- The per-object ceiling and the own-account check are unchanged; a refusal is
-- never looser than before, only correct under concurrency.
begin;

create or replace function public.findback_chat_file_budget_ok(
  p_user_id text,
  p_incoming bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_used bigint;
begin
  if p_user_id is null or p_user_id <> auth.uid()::text then
    return false;
  end if;
  if p_incoming is null or p_incoming < 0 or p_incoming > 104857600 then
    return false;
  end if;

  -- One lock per account, released at commit/rollback. This is the whole fix:
  -- concurrent probes for the same account can no longer read the same total.
  perform pg_advisory_xact_lock(
    hashtextextended('findback-chat-files:' || p_user_id, 0)
  );

  -- Same accounting as findback_chat_file_bytes_used: a completed object's
  -- `size`, an in-flight row's declared `contentLength`, anything else zero.
  -- This statement's snapshot is taken after the lock was granted.
  select coalesce(
    sum(
      case
        when (o.metadata ->> 'size') ~ '^[0-9]{1,12}$'
          then (o.metadata ->> 'size')::bigint
        when (o.metadata ->> 'contentLength') ~ '^[0-9]{1,12}$'
          then (o.metadata ->> 'contentLength')::bigint
        else 0
      end
    ),
    0
  )::bigint
  into v_used
  from storage.objects o
  where o.bucket_id = 'findback-chat-files'
    and starts_with(o.name, 'files/' || p_user_id || '/');

  return v_used + p_incoming <= 104857600;
end;
$$;

comment on function public.findback_chat_file_budget_ok(text, bigint)
  is $cmt$Cumulative chat-file budget predicate: true only when the caller is the account being charged and used + incoming stays within 104857600 bytes. Volatile on purpose: it serializes probes for one account with a transaction-scoped advisory lock and then sums committed objects, closing the two-upload race without a counter that Storage's repeated policy probes would double-charge.$cmt$;

commit;
