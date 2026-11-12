-- Owner order 2026-11-12 (R4): a conversation may carry files that are not
-- photos - documents, video, audio files - without touching the strict,
-- byte-verifying chat media gateway.
--
-- WHY A SECOND LANE. `findback-chat-media` accepts only byte-verified
-- JPEG/PNG/WebP (and voice containers) because the gateway re-sniffs every
-- upload before it commits metadata. Widening that verifier to a dozen office
-- and video containers would put the one security boundary that protects the
-- database at risk of a rushed parser. The owner's brief also says Storage is
-- only transport: a file does not need the media manifest, it needs a private
-- object the two conversation participants can read and nobody else can.
--
-- WHAT THIS FILE CREATES:
--   1. a private bucket `findback-chat-files`, 20 MB, with a server-enforced
--      MIME allowlist. Executables, scripts, HTML and SVG are absent, so the
--      bucket refuses them even if a client is tricked into trying;
--   2. one security-definer predicate the Storage policies can call, because
--      `authenticated` has no grant on `chat_conversations`;
--   3. owner-write and participant-read object policies. A sender writes only
--      under `files/<their uid>/<conversation id>/`, and a reader must be one
--      of the conversation's two members.
--
-- OBJECT LAYOUT. `files/<sender uid>/<conversation id>/<uuid>-<safe name>`.
-- The conversation id in the path is what lets a read policy decide access
-- without trusting anything the client put in the message body.
--
-- RETENTION. Objects are transport, not an archive. A message carries the
-- object key; deleting the message's row does not currently delete the object.
-- A bounded sweep is recorded as a follow-up in the owner-order ledger rather
-- than guessed here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'findback-chat-files',
  'findback-chat-files',
  false,
  20971520, -- 20 MB, mirrors the chat attachment ceiling
  array[
    -- documents
    'application/pdf',
    'application/rtf',
    'text/plain',
    'text/csv',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    -- archives
    'application/zip',
    'application/x-zip-compressed',
    -- video
    'video/mp4',
    'video/webm',
    'video/quicktime',
    -- audio files (not voice notes, which keep the media lane)
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/flac'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

-- Membership predicate used by the storage policies. SECURITY DEFINER is
-- required: the policies run as `authenticated`, which holds no grant on
-- chat_conversations. The argument is only ever an id, never an actor, so a
-- caller cannot ask about somebody else's membership.
create or replace function public.findback_chat_file_participant(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.chat_conversations c
    where c.id = p_conversation_id
      and auth.uid()::text in (c.user_a, c.user_b)
  )
$$;
revoke all on function public.findback_chat_file_participant(text) from public, anon, authenticated, service_role;
grant execute on function public.findback_chat_file_participant(text) to authenticated;

-- A sender may only create objects under their own uid and one conversation.
drop policy if exists findback_chat_files_insert_own on storage.objects;
create policy findback_chat_files_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'findback-chat-files'
    and (storage.foldername(name))[1] = 'files'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.findback_chat_file_participant((storage.foldername(name))[3])
  );

-- Reads: the sender, or either participant of the conversation in the path.
drop policy if exists findback_chat_files_select_participant on storage.objects;
create policy findback_chat_files_select_participant
  on storage.objects for select to authenticated
  using (
    bucket_id = 'findback-chat-files'
    and (storage.foldername(name))[1] = 'files'
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or public.findback_chat_file_participant((storage.foldername(name))[3])
    )
  );

-- The sender may remove their own object (an unsend, or a failed send).
drop policy if exists findback_chat_files_delete_own on storage.objects;
create policy findback_chat_files_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'findback-chat-files'
    and (storage.foldername(name))[1] = 'files'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
