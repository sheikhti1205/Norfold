-- Person report contract (DISPOSABLE synthetic probe; this transaction ROLLBACKs).
--
-- Run against a disposable PostgreSQL/Supabase test database after applying
-- 20261109010000_norfold_person_reports.sql. No production rows, accounts or
-- bodies. Every fixture id is synthetic.
--
-- Covers: the open-only dedupe index, one receipt for 0..20 selected messages,
-- digest/audience/unsent refusals, one rate-limit unit per person report,
-- captured image+voice metadata (with duration, without a storage key), the
-- grouped staff count, and the anon refusal.
begin;

-- ---------------------------------------------------------------------------
-- 1. Catalog shape.
-- ---------------------------------------------------------------------------
do $$ begin
  assert exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'content_reports_open_dedupe_key'
       and indexdef like 'CREATE UNIQUE INDEX%'
       and indexdef like '%status%'
  ), 'the open-report dedupe index exists and is partial';
  assert not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'content_reports_dedupe_key'
  ), 'the lifetime dedupe index is gone';
  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'chat_media_report_sources'
       and column_name = 'duration_ms'
  ), 'captured sources carry a voice duration';
  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'chat_media_report_evidence'
       and column_name = 'duration_ms'
  ), 'captured evidence carries a voice duration';
  assert not has_function_privilege(
    'anon',
    'public.findback_submit_person_report(text,text,text,text,text,text[],text[])',
    'execute'
  ), 'anon may not file a person report';
  assert has_function_privilege(
    'authenticated',
    'public.findback_submit_person_report(text,text,text,text,text,text[],text[])',
    'execute'
  ), 'authenticated may file a person report';
  assert not has_function_privilege(
    'anon', 'public.findback_moderation_queue_count()', 'execute'
  ), 'anon may not read the staff count';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Fixtures.
-- ---------------------------------------------------------------------------
insert into public.users (id, username, email, phone, password_hash, email_verified, phone_verified, avatar_url, created_at, updated_at)
values
 ('00000000-0000-4000-9911-000000000001', 'person_rep',  'person_rep@example.invalid',  '+19909911001', null, 1, 0, null, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
 ('00000000-0000-4000-9911-000000000002', 'person_peer', 'person_peer@example.invalid', '+19909911002', null, 1, 0, null, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
 ('00000000-0000-4000-9911-000000000003', 'person_out',  'person_out@example.invalid',  '+19909911003', null, 1, 0, null, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
 ('00000000-0000-4000-9911-000000000004', 'person_staff','person_staff@example.invalid','+19909911004', null, 1, 0, null, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role, granted_by, granted_at)
values (
  '00000000-0000-4000-9911-000000000004', 'ADMIN',
  '00000000-0000-4000-9911-000000000004', '2026-11-01T00:00:00.000Z'
) on conflict do nothing;

insert into public.chat_conversations (id, user_a, user_b, state, initiated_by)
values
 ('00000000-0000-4000-9911-000000000100',
  '00000000-0000-4000-9911-000000000001',
  '00000000-0000-4000-9911-000000000002', 'CONNECTED',
  '00000000-0000-4000-9911-000000000001'),
 ('00000000-0000-4000-9911-000000000101',
  '00000000-0000-4000-9911-000000000002',
  '00000000-0000-4000-9911-000000000003', 'CONNECTED',
  '00000000-0000-4000-9911-000000000002')
on conflict (id) do nothing;

-- The reporter is A; every reported row must be B's. m4 is unsent, m7 belongs
-- to a different conversation, and m5 is A's own message.
insert into public.chat_messages (id, conversation_id, sender_id, body, message_type, payload_digest, sent_at, unsent_at)
values
 ('00000000-0000-4000-9911-000000000201', '00000000-0000-4000-9911-000000000100', '00000000-0000-4000-9911-000000000002',
  'first note', 'TEXT', encode(sha256(convert_to('first note', 'UTF8')), 'hex'), '2026-11-01T09:00:00.000Z', null),
 ('00000000-0000-4000-9911-000000000202', '00000000-0000-4000-9911-000000000100', '00000000-0000-4000-9911-000000000002',
  '', 'MEDIA', encode(sha256(convert_to('', 'UTF8')), 'hex'), '2026-11-01T09:01:00.000Z', null),
 ('00000000-0000-4000-9911-000000000203', '00000000-0000-4000-9911-000000000100', '00000000-0000-4000-9911-000000000002',
  '', 'VOICE', encode(sha256(convert_to('', 'UTF8')), 'hex'), '2026-11-01T09:02:00.000Z', null),
 ('00000000-0000-4000-9911-000000000204', '00000000-0000-4000-9911-000000000100', '00000000-0000-4000-9911-000000000002',
  '', 'TEXT', encode(sha256(convert_to('', 'UTF8')), 'hex'), '2026-11-01T09:03:00.000Z', '2026-11-01T09:04:00.000Z'),
 ('00000000-0000-4000-9911-000000000205', '00000000-0000-4000-9911-000000000100', '00000000-0000-4000-9911-000000000001',
  'mine', 'TEXT', encode(sha256(convert_to('mine', 'UTF8')), 'hex'), '2026-11-01T09:05:00.000Z', null),
 ('00000000-0000-4000-9911-000000000206', '00000000-0000-4000-9911-000000000100', '00000000-0000-4000-9911-000000000002',
  'second note', 'TEXT', encode(sha256(convert_to('second note', 'UTF8')), 'hex'), '2026-11-01T09:06:00.000Z', null),
 ('00000000-0000-4000-9911-000000000207', '00000000-0000-4000-9911-000000000101', '00000000-0000-4000-9911-000000000002',
  'elsewhere', 'TEXT', encode(sha256(convert_to('elsewhere', 'UTF8')), 'hex'), '2026-11-01T09:07:00.000Z', null)
on conflict (id) do nothing;

insert into public.chat_message_audience (message_id, user_id)
select m.id, u.id
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  join public.users u on u.id in (c.user_a, c.user_b)
 where m.id in (
   '00000000-0000-4000-9911-000000000201', '00000000-0000-4000-9911-000000000202',
   '00000000-0000-4000-9911-000000000203', '00000000-0000-4000-9911-000000000204',
   '00000000-0000-4000-9911-000000000205', '00000000-0000-4000-9911-000000000206',
   '00000000-0000-4000-9911-000000000207'
 )
on conflict do nothing;

insert into public.chat_media_attachments (
  id, message_id, author_id, conversation_id, connection_epoch, block_epoch,
  generation, object_key, state, sha256, mime, byte_size, width, height, duration_ms, expires_at
) values
 ('00000000-0000-4000-9911-000000001001', '00000000-0000-4000-9911-000000000202',
  '00000000-0000-4000-9911-000000000002', '00000000-0000-4000-9911-000000000100',
  'epoch-a', 'block-a', 'generation-a', 'chat/person-report-image', 'ATTACHED',
  repeat('aa', 32), 'image/jpeg', 1234, 640, 480, null, clock_timestamp() + interval '1 hour'),
 ('00000000-0000-4000-9911-000000001002', '00000000-0000-4000-9911-000000000203',
  '00000000-0000-4000-9911-000000000002', '00000000-0000-4000-9911-000000000100',
  'epoch-a', 'block-a', 'generation-b', 'chat/person-report-voice', 'ATTACHED',
  repeat('bb', 32), 'audio/webm', 4000, 1, 1, 4200, clock_timestamp() + interval '1 hour');

-- ---------------------------------------------------------------------------
-- 3. The positive path: one person report with text, photo and voice evidence.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-9911-000000000001', true);
set local role authenticated;

do $$ declare v_id text; begin
  v_id := public.findback_submit_person_report(
    '00000000-0000-4000-9911-000000000001',
    '00000000-0000-4000-9911-000000000002',
    '00000000-0000-4000-9911-000000000100',
    'HARASSMENT',
    'They kept messaging me.',
    array[
      '00000000-0000-4000-9911-000000000201',
      '00000000-0000-4000-9911-000000000202',
      '00000000-0000-4000-9911-000000000203'
    ]::text[],
    array['first note', '', '']::text[]
  );
  assert v_id is not null, 'the person report is stored';
  perform set_config('person.r1', v_id, true);
end $$;

-- A retry of the same open case is the same receipt, even with the same
-- evidence: it creates no second report and consumes no second limit unit.
do $$ declare v_id text; begin
  v_id := public.findback_submit_person_report(
    '00000000-0000-4000-9911-000000000001',
    '00000000-0000-4000-9911-000000000002',
    '00000000-0000-4000-9911-000000000100',
    'HARASSMENT', null,
    array['00000000-0000-4000-9911-000000000201']::text[],
    array['first note']::text[]
  );
  assert v_id = current_setting('person.r1'), 'an open retry returns the surviving receipt';
end $$;

-- Every refusal below is neutral and stores nothing.
do $$ begin
  begin
    perform public.findback_submit_person_report(
      '00000000-0000-4000-9911-000000000001',
      '00000000-0000-4000-9911-000000000002',
      '00000000-0000-4000-9911-000000000100', 'OTHER', null,
      array['00000000-0000-4000-9911-000000000201']::text[],
      array['a different body']::text[]);
    raise exception 'a body that does not match the digest was accepted';
  exception when sqlstate 'P0002' then null; end;

  begin
    perform public.findback_submit_person_report(
      '00000000-0000-4000-9911-000000000001',
      '00000000-0000-4000-9911-000000000002',
      '00000000-0000-4000-9911-000000000100', 'OTHER', null,
      array['00000000-0000-4000-9911-000000000204']::text[],
      array['']::text[]);
    raise exception 'an unsent message was accepted';
  exception when sqlstate 'P0002' then null; end;

  begin
    perform public.findback_submit_person_report(
      '00000000-0000-4000-9911-000000000001',
      '00000000-0000-4000-9911-000000000002',
      '00000000-0000-4000-9911-000000000101', 'OTHER', null,
      array['00000000-0000-4000-9911-000000000207']::text[],
      array['elsewhere']::text[]);
    raise exception 'a message from a foreign conversation was accepted';
  exception when sqlstate 'P0002' then null; end;

  begin
    perform public.findback_submit_person_report(
      '00000000-0000-4000-9911-000000000001',
      '00000000-0000-4000-9911-000000000002',
      null, 'OTHER', null,
      array['00000000-0000-4000-9911-000000000205']::text[],
      array['mine']::text[]);
    raise exception 'the reporter''s own message was accepted as the peer''s';
  exception when sqlstate 'P0002' then null; end;

  begin
    perform public.findback_submit_person_report(
      '00000000-0000-4000-9911-000000000001',
      '00000000-0000-4000-9911-000000000001',
      null, 'OTHER', null, '{}'::text[], '{}'::text[]);
    raise exception 'a self-report was accepted';
  exception when sqlstate 'P0002' then null; end;

  begin
    perform public.findback_submit_person_report(
      '00000000-0000-4000-9911-000000000001',
      '00000000-0000-4000-9911-000000000002',
      '00000000-0000-4000-9911-000000000100', 'OTHER', null,
      (select array_agg('00000000-0000-4000-9911-' || lpad(n::text, 12, '0'))
         from generate_series(1, 21) n),
      (select array_agg('') from generate_series(1, 21) n));
    raise exception 'more than twenty messages were accepted';
  exception when sqlstate '22023' then null; end;

  begin
    perform public.findback_submit_person_report(
      '00000000-0000-4000-9911-000000000001',
      '00000000-0000-4000-9911-000000000002',
      '00000000-0000-4000-9911-000000000100', 'OTHER', null,
      array['00000000-0000-4000-9911-000000000201',
            '00000000-0000-4000-9911-000000000201']::text[],
      array['first note', 'first note']::text[]);
    raise exception 'a duplicated message id was accepted';
  exception when sqlstate '22023' then null; end;
end $$;

reset role;

do $$ begin
  assert (select count(*) from public.content_reports
           where reporter_user_id = '00000000-0000-4000-9911-000000000001'
             and target_type = 'USER'
             and target_id = '00000000-0000-4000-9911-000000000002') = 1,
    'the refused probes stored no report';
  assert (select case_type from public.content_reports where id = current_setting('person.r1')) = 'USER',
    'the report case is the person, not a message';
  assert (select jsonb_array_length(evidence_snapshot->'messages') from public.content_reports
           where id = current_setting('person.r1')) = 3,
    'all three selected messages are in the snapshot';
  assert (select evidence_snapshot->'messages'->0->>'message_type' from public.content_reports
           where id = current_setting('person.r1')) = 'VOICE',
    'the snapshot is newest first';
  assert (select count(*) from public.chat_media_report_sources
           where report_id = current_setting('person.r1')) = 2,
    'photo and voice attachments are captured';
  assert (select duration_ms from public.chat_media_report_sources
           where report_id = current_setting('person.r1')
             and mime = 'audio/webm') = 4200,
    'the captured voice copy keeps its measured duration';
  assert (select duration_ms from public.chat_media_report_sources
           where report_id = current_setting('person.r1')
             and mime = 'image/jpeg') is null,
    'a photo has no voice duration';
end $$;

-- ---------------------------------------------------------------------------
-- 4. A closed case may be reported again; the open dedupe key must allow it.
-- ---------------------------------------------------------------------------
update public.content_reports
   set status = 'RESOLVED',
       created_at = to_char((clock_timestamp() at time zone 'utc') - interval '1 hour',
                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 where id = current_setting('person.r1');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-9911-000000000001', true);
set local role authenticated;
do $$ declare v_id text; begin
  v_id := public.findback_submit_person_report(
    '00000000-0000-4000-9911-000000000001',
    '00000000-0000-4000-9911-000000000002',
    '00000000-0000-4000-9911-000000000100',
    'HARASSMENT', 'It happened again.',
    array['00000000-0000-4000-9911-000000000206']::text[],
    array['second note']::text[]
  );
  assert v_id <> current_setting('person.r1'), 'a closed report does not lock the person';
  perform set_config('person.r2', v_id, true);
end $$;
reset role;

-- The service worker claims each captured copy; the manifest carries duration
-- and never a storage key to a client.
do $$ declare v_job jsonb; begin
  v_job := public.findback_claim_chat_media_evidence_job();
  assert v_job->>'mime' = 'image/jpeg', 'the first captured copy is the photo';
  assert v_job->>'sourceObjectKey' = 'chat/person-report-image', 'the worker may read the private source key';
  v_job := public.findback_claim_chat_media_evidence_job();
  assert v_job->>'mime' = 'audio/webm', 'the second captured copy is the voice note';
  assert (v_job->>'durationMs')::integer = 4200, 'the evidence work carries the voice duration';
end $$;

-- ---------------------------------------------------------------------------
-- 5. The staff view: grouped count, selected messages, media metadata only.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-9911-000000000004', true);
set local role authenticated;

do $$ declare v_count integer; v_queue integer; v_target jsonb; begin
  v_count := public.findback_moderation_queue_count();
  select count(*) into v_queue from public.findback_moderation_queue(100);
  assert v_count = v_queue, 'the badge counts exactly the grouped cases the queue shows';
  assert v_count >= 1, 'the staff count sees the open person case';

  v_target := public.findback_moderation_target(
    'USER', '00000000-0000-4000-9911-000000000002'
  );
  assert (v_target->>'target_exists')::boolean, 'the person exists';
  assert jsonb_array_length(v_target->'reports') = 2, 'both receipts are on one person case';
  -- The newest report is the one-message re-report.
  assert jsonb_array_length(v_target->'reports'->0->'evidence'->'messages') = 1,
    'the re-report carries the message the reporter selected';
  assert jsonb_array_length(v_target->'reports'->1->'evidence'->'messages') = 3,
    'the first report keeps its three selected messages';
  assert jsonb_array_length(v_target->'reports'->1->'media') = 2,
    'the captured media is projected as metadata';
  assert (v_target->'reports'->1->'media'->0->>'duration_ms') is null
    or (v_target->'reports'->1->'media'->0->>'duration_ms') = '4200',
    'the manifest carries a voice duration when the copy is audio';
  assert not (v_target::text like '%objectKey%'), 'the case never exposes a storage key';
  assert not (v_target::text like '%findback-chat-media%'), 'the case never exposes a bucket';
  assert not (v_target::text like '%chat/person-report-%'), 'the case never exposes a private path';
end $$;

reset role;
rollback;
