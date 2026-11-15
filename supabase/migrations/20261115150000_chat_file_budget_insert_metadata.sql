-- Owner audit 2026-11-15 (P0 follow-up, fix forward): 20261115140000 read
-- `metadata ->> 'size'` in the chat-file insert policy, but Supabase Storage
-- (1.94.2, the deployed version) writes `{mimetype, contentLength,
-- contentEncoding}` on the insert probe and adds `size` only when the upload
-- completes. The predicate received null and refused EVERY chat-file upload
-- with "new row violates row-level security policy". Applied migrations are
-- immutable, so this migration corrects the policy forward.
--
-- WHERE THE SIZE COMES FROM, AT EACH PROBE.
--   1. Pre-upload probe (`canUpload` -> `authorizeUpload`): the row metadata has
--      no `size`. Binary uploads carry the declared content length; a
--      multipart/form-data upload carries the request's Content-Length, whose
--      boundary overhead can only overcharge by a few hundred bytes. A chunked
--      multipart request has neither, and cannot be measured yet.
--   2. Completion probe (`completeUpload` -> `authorizeUpload`): the same
--      insert policy is evaluated again with the completed metadata, which
--      always carries `size`. A refusal there aborts the upload and removes the
--      stored bytes.
-- So: charge `size` when present, else `contentLength`; when neither is present
-- yet, defer to the completion probe instead of refusing. The cumulative
-- ceiling still applies to every object that actually lands.
--
-- UNMEASURABLE STORED ROWS TOTAL ZERO, NOT OVER BUDGET. A row that never
-- completes holds no bucket bytes. Charging it 104857601 (the previous
-- fail-closed value) would lock the account out after one aborted upload. Real
-- objects always carry `size` on completion, so an undercount cannot survive a
-- successful upload.
--
-- NO DYNAMIC DDL: no DO block, no EXECUTE, no format().
begin;

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
        -- A completed object carries `size`; an in-flight row carries the
        -- declared `contentLength`; anything else holds no measurable bytes.
        when (o.metadata ->> 'size') ~ '^[0-9]{1,12}$'
          then (o.metadata ->> 'size')::bigint
        when (o.metadata ->> 'contentLength') ~ '^[0-9]{1,12}$'
          then (o.metadata ->> 'contentLength')::bigint
        else 0
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

drop policy if exists findback_chat_files_insert_own on storage.objects;
create policy findback_chat_files_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'findback-chat-files'
    and (storage.foldername(name))[1] = 'files'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.findback_chat_file_participant((storage.foldername(name))[3])
    and case
      when (metadata ->> 'size') ~ '^[0-9]{1,12}$'
        then public.findback_chat_file_budget_ok(
          (select auth.uid())::text,
          (metadata ->> 'size')::bigint
        )
      when (metadata ->> 'contentLength') ~ '^[0-9]{1,12}$'
        then public.findback_chat_file_budget_ok(
          (select auth.uid())::text,
          (metadata ->> 'contentLength')::bigint
        )
      else true
    end
  );

commit;
