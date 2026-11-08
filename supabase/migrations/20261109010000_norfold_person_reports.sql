-- Person reports carry the recent messages a reporter chose, not only a name.
--
-- The owner requirement: reporting a person sends the 5 most recent messages
-- from that person by default — text, image or voice — and the reporter may
-- select fewer or more. One person report is ONE receipt and ONE rate-limit
-- unit; it never becomes five message reports.
--
-- What this migration adds:
--   * an open-report dedupe rule, so repeat misconduct after a closed case can
--     be reported again while an open case still answers retries idempotently;
--   * public.findback_submit_person_report(...), which validates every selected
--     message against the reporter's audience, the peer as sender, unsent_at,
--     and the body digest before storing a bounded snapshot;
--   * media capture for USER reports (images and voice), carrying duration;
--   * public.findback_moderation_queue_count() for an honest staff badge.
--
-- Evidence stays server-built. No client-supplied type, sequence, sender,
-- attachment id, storage key or snapshot is accepted. Media bytes are copied
-- from the original attachment by the service worker, never uploaded as
-- "evidence" by the reporter.
--
-- LIVE-PENDING: apply and verify with
-- supabase/tests/verify_norfold_person_reports.sql before any client build
-- depends on it. Additive only; applied migrations stay immutable.
begin;

-- ---------------------------------------------------------------------------
-- 1. Dedupe an OPEN case, not a lifetime.
--
--    The lifetime key made a person reportable once for the life of the
--    account, so repeat harassment after a closed case could never carry new
--    evidence. A partial key keeps retry idempotence while the case is open.
--    Every writer that looks up or inserts a receipt uses the same predicate.
-- ---------------------------------------------------------------------------
drop index if exists public.content_reports_dedupe_key;
create unique index if not exists content_reports_open_dedupe_key
  on public.content_reports (reporter_user_id, target_type, target_id)
  where status in ('OPEN', 'UNDER_REVIEW');

comment on index public.content_reports_open_dedupe_key is
  'One OPEN/UNDER_REVIEW report per (reporter, target). A closed case may be reported again; an open case answers a retry with the same receipt.';

-- ---------------------------------------------------------------------------
-- 2. The existing writers answer only an OPEN case as a retry.
-- ---------------------------------------------------------------------------
create or replace function public.findback_submit_report(p_target_type text,p_target_id text,p_reason text,p_detail text)
returns text language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_uid text:=auth.uid()::text; v_detail text:=nullif(btrim(coalesce(p_detail,'')),'');
  v_now text; v_limit integer; v_burst integer; v_count integer; v_last text; v_existing text; v_snapshot jsonb; v_id text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
  if p_target_type is null or p_target_type not in ('POST','COMMENT','USER') then
    raise exception 'Unknown report target type' using errcode='22023'; end if;
  if p_target_id is null or btrim(p_target_id)='' then
    raise exception 'A report target id is required' using errcode='22023'; end if;
  if p_reason is null or p_reason<>all(public.findback_report_reasons()) then
    raise exception 'Unknown report reason' using errcode='22023'; end if;
  if char_length(v_detail)>2000 then raise exception 'Report detail is too long' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('findback_report:'||v_uid,0));
  -- An OPEN duplicate retry returns the SURVIVING receipt id before any limit
  -- is considered (the measured ordering inference). It never raises 23505.
  -- A CLOSED receipt is history, not a lock on the target.
  select r.id into v_existing from public.content_reports r
    where r.reporter_user_id=v_uid and r.target_type=p_target_type and r.target_id=p_target_id
      and r.status in ('OPEN','UNDER_REVIEW');
  -- Only COMMENT retry moves ahead of visibility: its first report conceals
  -- the subject for this reporter. Preserve existing POST/USER availability.
  if p_target_type='COMMENT' and v_existing is not null then return v_existing; end if;
  perform pg_advisory_xact_lock(hashtextextended('findback_moderation:'||p_target_type||':'||p_target_id,0));
  if(p_target_type='POST' and not public.findback_can_read_post_for(p_target_id,v_uid))
    or(p_target_type='COMMENT' and not public.findback_can_read_comment_for(p_target_id,v_uid))
    or(p_target_type='USER' and not exists(select 1 from public.users u where u.id=p_target_id)) then
    raise exception 'Report target unavailable' using errcode='P0002'; end if;
  if v_existing is not null then return v_existing; end if;
  v_now:=to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select l.limit_per_day,l.burst_cooldown_seconds into v_limit,v_burst from public.findback_report_limit()l;
  select count(*),max(r.created_at) into v_count,v_last from public.content_reports r where r.reporter_user_id=v_uid
    and r.created_at>=to_char((clock_timestamp() at time zone 'utc')-interval '24 hours','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_count>=v_limit or(v_last is not null and v_last>to_char((clock_timestamp() at time zone 'utc')-
    make_interval(secs=>v_burst),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) then
    raise exception 'REPORT_LIMIT_REACHED' using errcode='P0001'; end if;
  v_snapshot:=public.findback_capture_report_evidence(p_target_type,p_target_id);
  if v_snapshot is null then raise exception 'Report target unavailable' using errcode='P0002'; end if;
  insert into public.content_reports(id,reporter_user_id,target_type,target_id,
    target_post_id,target_comment_id,target_user_id,reason,detail,status,
    evidence_snapshot,evidence_captured_at,evidence_expires_at,created_at,updated_at)
  values(gen_random_uuid()::text,v_uid,p_target_type,p_target_id,
    case when p_target_type='POST' then p_target_id end,
    case when p_target_type='COMMENT' then p_target_id end,
    case when p_target_type='USER' then p_target_id end,
    p_reason,v_detail,'OPEN',v_snapshot,v_now,
    to_char((clock_timestamp() at time zone 'utc')+interval '90 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),v_now,v_now)
    returning id into v_id;
  if p_target_type='COMMENT' then
    -- Reporting is recipient-local, not a shared wrongdoing announcement.
    perform realtime.send(jsonb_build_object('postId',v_snapshot->>'post_id','entity','comment','invalidate',true),
      'comment:invalidate','notification:'||v_uid,true);
  end if;
  return v_id;
end $$;

revoke all on function public.findback_submit_report(text, text, text, text) from public, anon;
grant execute on function public.findback_submit_report(text, text, text, text) to authenticated;

-- The message writer answers only an OPEN case as a retry too. Everything else
-- about it is unchanged: the digest, the audience and the case lock still own
-- admission.
create or replace function public.findback_submit_message_report(
 p_account_id text,p_message_id text,p_reason text,p_detail text,p_body text
) returns text language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare
 v_uid text:=auth.uid()::text; v_detail text:=nullif(btrim(coalesce(p_detail,'')),'');
 v_message public.chat_messages%rowtype; v_existing text; v_id text; v_now text;
 v_limit integer; v_burst integer; v_count integer; v_last text; v_snapshot jsonb;
begin
 if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 if p_account_id is null or p_account_id<>v_uid then raise exception 'Session changed' using errcode='42501'; end if;
 if p_message_id is null or btrim(p_message_id)='' then raise exception 'Report target unavailable' using errcode='P0002'; end if;
 if p_reason is null or p_reason<>all(public.findback_report_reasons()) then raise exception 'Unknown report reason' using errcode='22023'; end if;
 if char_length(v_detail)>2000 then raise exception 'Report detail is too long' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('findback_report:'||v_uid,0));
 -- A retry is a receipt lookup owned by this authenticated reporter, including
 -- after unsend or message unlinkage; it never changes captured evidence.
 select r.id into v_existing from public.content_reports r where r.reporter_user_id=v_uid
  and r.target_type='MESSAGE' and r.target_id=p_message_id
  and r.status in ('OPEN','UNDER_REVIEW');
 if v_existing is not null then return v_existing; end if;
 select m.* into v_message from public.chat_messages m
  join public.chat_conversations c on c.id=m.conversation_id
  join public.chat_message_audience a on a.message_id=m.id and a.user_id=v_uid
  where m.id=p_message_id and v_uid in(c.user_a,c.user_b) and m.sender_id in(c.user_a,c.user_b);
 if not found or p_body is null or length(p_body)>100000 or v_message.payload_digest is null
    or encode(sha256(convert_to(p_body,'UTF8')),'hex') is distinct from v_message.payload_digest then
  raise exception 'Report target unavailable' using errcode='P0002';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('findback_moderation:USER:'||v_message.sender_id,0));
 -- Recheck delivery provenance after the case lock; row deletion is serialized
 -- by the message FK on insert. Missing or changed identity fails closed.
 if not exists(select 1 from public.chat_messages m join public.chat_conversations c on c.id=m.conversation_id
  join public.chat_message_audience a on a.message_id=m.id and a.user_id=v_uid
  where m.id=p_message_id and m.sender_id=v_message.sender_id and v_uid in(c.user_a,c.user_b)
   and m.sender_id in(c.user_a,c.user_b) and m.payload_digest=v_message.payload_digest) then
  raise exception 'Report target unavailable' using errcode='P0002';
 end if;
 v_now:=to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 select l.limit_per_day,l.burst_cooldown_seconds into v_limit,v_burst from public.findback_report_limit() l;
 select count(*),max(r.created_at) into v_count,v_last from public.content_reports r where r.reporter_user_id=v_uid
  and r.created_at>=to_char((clock_timestamp() at time zone 'utc')-interval '24 hours','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 if v_count>=v_limit or (v_last is not null and v_last>to_char((clock_timestamp() at time zone 'utc')-
  make_interval(secs=>v_burst),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) then
  raise exception 'REPORT_LIMIT_REACHED' using errcode='P0001';
 end if;
 v_snapshot:=jsonb_build_object('target_type','MESSAGE','body_excerpt',left(p_body,500),
  'event_sequence',v_message.event_sequence,'captured_at',v_now);
 insert into public.content_reports(id,reporter_user_id,target_type,target_id,target_message_id,
  reason,detail,status,evidence_snapshot,evidence_captured_at,evidence_expires_at,created_at,updated_at)
 values(gen_random_uuid()::text,v_uid,'MESSAGE',p_message_id,p_message_id,p_reason,v_detail,'OPEN',v_snapshot,v_now,
  to_char((clock_timestamp() at time zone 'utc')+interval '90 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),v_now,v_now)
 returning id into v_id;
 return v_id;
end $$;

revoke all on function public.findback_submit_message_report(text,text,text,text,text) from public,anon;
grant execute on function public.findback_submit_message_report(text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The person report writer.
--
--    Validated server-side, one receipt, bounded at 20 messages and 10,000
--    characters of excerpts. The client sends the body it still has; the
--    server verifies each against the stored payload digest and reads type,
--    sequence, sender, conversation and attachment from its own rows.
-- ---------------------------------------------------------------------------
create function public.findback_submit_person_report(
  p_account_id text,
  p_peer_id text,
  p_conversation_id text,
  p_reason text,
  p_detail text,
  p_message_ids text[],
  p_bodies text[]
) returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := auth.uid()::text;
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
  v_ids text[] := coalesce(p_message_ids, '{}'::text[]);
  v_bodies text[] := coalesce(p_bodies, '{}'::text[]);
  v_count integer := coalesce(cardinality(p_message_ids), 0);
  v_conversation text;
  v_matched integer := 0;
  v_excerpt_chars integer := 0;
  v_messages jsonb;
  v_snapshot jsonb;
  v_now text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_limit integer;
  v_burst integer;
  v_day_count integer;
  v_last text;
  v_existing text;
  v_id text;
  v_username text;
  v_display_name text;
  v_avatar_url text;
  v_account_created text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_account_id is null or p_account_id <> v_uid then
    raise exception 'Session changed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason <> all (public.findback_report_reasons()) then
    raise exception 'Unknown report reason' using errcode = '22023';
  end if;
  if v_detail is not null and char_length(v_detail) > 2000 then
    raise exception 'Report detail is too long' using errcode = '22023';
  end if;

  -- The peer must be a real, different account. Self-report and unknown ids
  -- answer the same neutral refusal so the writer is not an existence oracle.
  if p_peer_id is null or btrim(p_peer_id) = '' or p_peer_id = v_uid then
    raise exception 'Report target unavailable' using errcode = 'P0002';
  end if;
  select u.username, u.display_name, u.avatar_url,
         to_char(u.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    into v_username, v_display_name, v_avatar_url, v_account_created
    from public.users u
   where u.id = p_peer_id;
  if not found then
    raise exception 'Report target unavailable' using errcode = 'P0002';
  end if;

  -- Bounds. Reject the whole request; never store a partial selection.
  if v_count > 20 then
    raise exception 'Too many messages selected' using errcode = '22023';
  end if;
  if v_count > 0 then
    if p_message_ids is null or p_bodies is null or cardinality(p_bodies) <> v_count then
      raise exception 'Message evidence is malformed' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_ids) as x where x is null or btrim(x) = '') then
      raise exception 'Report target unavailable' using errcode = 'P0002';
    end if;
    if (select count(distinct x) from unnest(v_ids) as x) <> v_count then
      raise exception 'Message evidence is malformed' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_bodies) as x where x is null or char_length(x) > 100000) then
      raise exception 'Message evidence is malformed' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('findback_report:' || v_uid, 0));

  -- Resolve the 1:1 conversation. A supplied id must have both participants;
  -- with no id, the unique pair row is used. No conversation is allowed only
  -- when no message evidence is attached (a profile-only report).
  if p_conversation_id is not null and btrim(p_conversation_id) <> '' then
    select c.id into v_conversation
      from public.chat_conversations c
     where c.id = p_conversation_id
       and c.user_a <> c.user_b
       and v_uid in (c.user_a, c.user_b)
       and p_peer_id in (c.user_a, c.user_b);
    if v_conversation is null then
      raise exception 'Report target unavailable' using errcode = 'P0002';
    end if;
  else
    select c.id into v_conversation
      from public.chat_conversations c
     where (c.user_a = v_uid and c.user_b = p_peer_id)
        or (c.user_a = p_peer_id and c.user_b = v_uid)
     order by c.created_at desc
     limit 1;
  end if;

  if v_count > 0 then
    if v_conversation is null then
      raise exception 'Report target unavailable' using errcode = 'P0002';
    end if;
    -- Every selected row must be in this conversation, sent by the peer, still
    -- delivered to the reporter, not unsent, and have a verifiable digest.
    select count(*) into v_matched
      from public.chat_messages m
      join public.chat_message_audience a on a.message_id = m.id and a.user_id = v_uid
     where m.conversation_id = v_conversation
       and m.id = any (v_ids)
       and m.sender_id = p_peer_id
       and m.unsent_at is null
       and m.message_type in ('TEXT', 'MEDIA', 'LOCATION', 'VOICE')
       and m.payload_digest is not null;
    if v_matched <> v_count then
      raise exception 'Report target unavailable' using errcode = 'P0002';
    end if;
    if exists (
      select 1
        from unnest(v_ids, v_bodies) as t(mid, body)
        join public.chat_messages m on m.id = t.mid
       where encode(sha256(convert_to(t.body, 'UTF8')), 'hex') is distinct from m.payload_digest
    ) then
      raise exception 'Report target unavailable' using errcode = 'P0002';
    end if;
    select coalesce(sum(char_length(left(t.body, 500))), 0) into v_excerpt_chars
      from unnest(v_bodies) as t(body);
    if v_excerpt_chars > 10000 then
      raise exception 'Message evidence is too large' using errcode = '22023';
    end if;

    -- Hold the selected rows until the receipt is committed, so a concurrent
    -- delete cannot remove the evidence between verification and capture.
    perform 1 from public.chat_messages m where m.id = any (v_ids) for share;

    -- Build the snapshot from server rows only. Coordinates are deliberately
    -- NOT copied: the message type is enough for review, and location is the
    -- most sensitive field on the row.
    select jsonb_agg(jsonb_build_object(
             'message_id', m.id,
             'event_sequence', m.event_sequence,
             'message_type', m.message_type,
             'sent_at', to_char(m.sent_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'body_excerpt', left(t.body, 500),
             'media', case when a.id is null then null else jsonb_build_object(
               'kind', case when a.mime like 'audio/%' then 'VOICE' else 'IMAGE' end,
               'mime', a.mime,
               'duration_ms', a.duration_ms
             ) end
           ) order by m.event_sequence desc, m.id desc)
      into v_messages
      from unnest(v_ids, v_bodies) as t(mid, body)
      join public.chat_messages m on m.id = t.mid
      left join lateral (
        select x.id, x.mime, x.duration_ms
          from public.chat_media_attachments x
         where x.message_id = m.id and x.state = 'ATTACHED'
           and x.expires_at > clock_timestamp()
         order by x.id
         limit 1
      ) a on true;
  else
    v_messages := '[]'::jsonb;
  end if;

  -- An OPEN duplicate retry returns the surviving receipt before the limit.
  select r.id into v_existing
    from public.content_reports r
   where r.reporter_user_id = v_uid
     and r.target_type = 'USER'
     and r.target_id = p_peer_id
     and r.status in ('OPEN', 'UNDER_REVIEW');
  if v_existing is not null then
    return v_existing;
  end if;

  select l.limit_per_day, l.burst_cooldown_seconds into v_limit, v_burst
    from public.findback_report_limit() l;
  select count(*), max(r.created_at) into v_day_count, v_last
    from public.content_reports r
   where r.reporter_user_id = v_uid
     and r.created_at >= to_char((clock_timestamp() at time zone 'utc') - interval '24 hours',
                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_day_count >= v_limit then
    raise exception 'REPORT_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if v_last is not null
     and v_last > to_char((clock_timestamp() at time zone 'utc') - make_interval(secs => v_burst),
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then
    raise exception 'REPORT_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  -- One case per person serializes the report group with the one decider.
  perform pg_advisory_xact_lock(hashtextextended('findback_moderation:USER:' || p_peer_id, 0));

  v_snapshot := jsonb_build_object(
    'target_type', 'USER',
    'username', v_username,
    'display_name', v_display_name,
    'avatar_url', v_avatar_url,
    'account_created_at', v_account_created,
    'captured_at', v_now,
    'messages', v_messages
  );

  insert into public.content_reports (
    id, reporter_user_id, target_type, target_id, target_user_id,
    reason, detail, status, evidence_snapshot,
    evidence_captured_at, evidence_expires_at, created_at, updated_at
  ) values (
    gen_random_uuid()::text, v_uid, 'USER', p_peer_id, p_peer_id,
    p_reason, v_detail, 'OPEN', v_snapshot,
    v_now,
    to_char((clock_timestamp() at time zone 'utc') + interval '90 days',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    v_now, v_now
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.findback_submit_person_report(text, text, text, text, text, text[], text[]) from public, anon;
grant execute on function public.findback_submit_person_report(text, text, text, text, text, text[], text[]) to authenticated;

comment on function public.findback_submit_person_report(text, text, text, text, text, text[], text[]) is
  'Person report writer (definer, authenticated): one receipt for a peer plus 0..20 reporter-selected messages, each verified against the server payload digest. Unsent, foreign, undisclosed and malformed selections fail the whole request neutrally.';

-- ---------------------------------------------------------------------------
-- 4. Captured media carries a voice duration.
--
--    The attachment itself already stores it; the evidence copy must too,
--    otherwise the staff manifest cannot say how long a reported note is.
-- ---------------------------------------------------------------------------
alter table public.chat_media_report_sources add column if not exists duration_ms integer;
alter table public.chat_media_report_evidence add column if not exists duration_ms integer;

-- Backfill a voice copy captured before this column existed. The attachment
-- row is the measured authority; if it is already gone the copy keeps NULL and
-- the audio-shape check below is left NOT VALID for that historical row.
update public.chat_media_report_sources s
   set duration_ms = a.duration_ms
  from public.chat_media_attachments a
 where a.id = s.source_attachment_id and s.duration_ms is null and a.duration_ms is not null;
update public.chat_media_report_evidence e
   set duration_ms = a.duration_ms
  from public.chat_media_attachments a
 where a.id = e.source_attachment_id and e.duration_ms is null and a.duration_ms is not null;

alter table public.chat_media_report_sources drop constraint if exists chat_media_report_sources_duration_shape;
alter table public.chat_media_report_sources add constraint chat_media_report_sources_duration_shape
  check (duration_ms is null or duration_ms between 500 and 300000) not valid;
alter table public.chat_media_report_evidence drop constraint if exists chat_media_report_evidence_duration_shape;
alter table public.chat_media_report_evidence add constraint chat_media_report_evidence_duration_shape
  check (duration_ms is null or duration_ms between 500 and 300000) not valid;

alter table public.chat_media_report_sources drop constraint if exists chat_media_report_sources_audio_shape;
alter table public.chat_media_report_sources add constraint chat_media_report_sources_audio_shape
  check ((mime like 'audio/%') = (duration_ms is not null)) not valid;
alter table public.chat_media_report_evidence drop constraint if exists chat_media_report_evidence_audio_shape;
alter table public.chat_media_report_evidence add constraint chat_media_report_evidence_audio_shape
  check ((mime like 'audio/%') = (duration_ms is not null)) not valid;

-- The range is validated now. The audio-shape check stays NOT VALID so a
-- historical voice copy whose original attachment is already gone cannot block
-- the deploy; every new insert is still checked.
alter table public.chat_media_report_sources validate constraint chat_media_report_sources_duration_shape;
alter table public.chat_media_report_evidence validate constraint chat_media_report_evidence_duration_shape;

-- The MESSAGE branch is unchanged. The USER branch captures exactly the
-- attachments of the message ids the writer put in its snapshot.
create or replace function public.findback_capture_chat_media_report_sources() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare source record;
begin
 if new.target_type='MESSAGE' then
  if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Media capture requires READ COMMITTED' using errcode='25001';
  end if;
  for source in select a.id,a.generation,a.object_key from public.chat_media_attachments a
   where a.message_id=new.target_id and a.state='ATTACHED' and a.expires_at>clock_timestamp()
   order by a.id,a.generation,a.object_key
  loop
   perform pg_advisory_xact_lock(public.findback_chat_media_source_lock_key(source.id,source.generation,source.object_key));
   -- A separate volatile statement obtains a fresh READ COMMITTED snapshot
   -- after waiting. Never capture an expired/deleted pre-lock row. The lock
   -- remains held until the report and its sources become visible together.
   insert into public.chat_media_report_sources(report_id,source_attachment_id,source_message_id,
    source_generation,source_object_key,sha256,mime,byte_size,width,height,duration_ms)
   select new.id,a.id,a.message_id,a.generation,a.object_key,a.sha256,a.mime,a.byte_size,a.width,a.height,a.duration_ms
    from public.chat_media_attachments a
    where a.id=source.id and a.generation=source.generation and a.object_key=source.object_key
     and a.message_id=new.target_id and a.state='ATTACHED' and a.expires_at>clock_timestamp();
  end loop;
 elsif new.target_type='USER' then
  if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Media capture requires READ COMMITTED' using errcode='25001';
  end if;
  for source in select a.id,a.message_id,a.generation,a.object_key
   from jsonb_array_elements(coalesce(new.evidence_snapshot->'messages','[]'::jsonb)) as msg
   join public.chat_media_attachments a on a.message_id=msg->>'message_id'
   where a.state='ATTACHED' and a.expires_at>clock_timestamp()
   order by a.id,a.generation,a.object_key
  loop
   perform pg_advisory_xact_lock(public.findback_chat_media_source_lock_key(source.id,source.generation,source.object_key));
   insert into public.chat_media_report_sources(report_id,source_attachment_id,source_message_id,
    source_generation,source_object_key,sha256,mime,byte_size,width,height,duration_ms)
   select new.id,a.id,a.message_id,a.generation,a.object_key,a.sha256,a.mime,a.byte_size,a.width,a.height,a.duration_ms
    from public.chat_media_attachments a
    where a.id=source.id and a.generation=source.generation and a.object_key=source.object_key
     and a.message_id=source.message_id and a.state='ATTACHED' and a.expires_at>clock_timestamp();
  end loop;
 end if;
 return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Service-owned copy work accepts a person report's captured sources.
-- ---------------------------------------------------------------------------
create or replace function public.findback_claim_chat_media_evidence_job()
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_report_id text; v_source_id text; r public.content_reports%rowtype;
 s public.chat_media_report_sources%rowtype; e public.chat_media_report_evidence%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Evidence work requires READ COMMITTED' using errcode='25001';
 end if;
 -- Lock the parent, not a nullable evidence row. Another worker skips the
 -- report rather than blocking or claiming the same unfinished destination.
 select report.id,source.source_attachment_id into v_report_id,v_source_id
 from public.content_reports report
 join public.chat_media_report_sources source on source.report_id=report.id
 left join public.chat_media_report_evidence evidence on evidence.report_id=report.id
  and evidence.source_attachment_id=source.source_attachment_id
 where report.target_type in ('MESSAGE','USER') and report.evidence_erased_at is null
  and report.evidence_expires_at::timestamptz>clock_timestamp()
  and (evidence.id is null or (evidence.state='PENDING'
   and evidence.expires_at>clock_timestamp()
   and (evidence.work_expires_at is null or evidence.work_expires_at<=clock_timestamp())))
 order by report.created_at,report.id,source.source_attachment_id
 limit 1 for update of report skip locked;
 if not found then return null; end if;
 -- Re-read after the parent fence, matching canonical reserve/commit/expiry.
 select * into r from public.content_reports where id=v_report_id;
 if r.evidence_erased_at is not null or r.evidence_expires_at::timestamptz<=clock_timestamp() then return null; end if;
 select * into s from public.chat_media_report_sources
  where report_id=r.id and source_attachment_id=v_source_id for update;
 if not found then return null; end if;
 select * into e from public.chat_media_report_evidence
  where report_id=r.id and source_attachment_id=s.source_attachment_id for update;
 if found then
  if e.state<>'PENDING' or e.expires_at<=clock_timestamp()
   or e.work_expires_at>clock_timestamp() then return null; end if;
 else
  -- No caller-chosen ID: report/source locks and the canonical unique key
  -- serialize construction. Do not invert reserve's ID advisory -> report
  -- order by calling the caller-ID reserve function under this report lock.
  insert into public.chat_media_report_evidence(id,report_id,source_attachment_id,source_message_id,
   object_key,sha256,mime,byte_size,width,height,duration_ms,expires_at)
  values(gen_random_uuid()::text,r.id,s.source_attachment_id,s.source_message_id,
   'evidence/'||gen_random_uuid()::text,s.sha256,s.mime,s.byte_size,s.width,s.height,s.duration_ms,
   r.evidence_expires_at::timestamptz) returning * into e;
 end if;
 update public.chat_media_report_evidence
  set work_token=gen_random_uuid()::text,
   work_expires_at=least(clock_timestamp()+interval '5 minutes',e.expires_at)
  where id=e.id returning * into e;
 return jsonb_build_object('id',e.id,'reportId',r.id,'sourceAttachmentId',s.source_attachment_id,
  'generation',e.generation,'workToken',e.work_token,'workExpiresAt',e.work_expires_at,
  'sourceBucket','findback-chat-media','sourceObjectKey',s.source_object_key,
  'bucket','findback-chat-moderation-evidence','objectKey',e.object_key,
  'sha256',e.sha256,'mime',e.mime,'bytes',e.byte_size,'width',e.width,'height',e.height,
  'durationMs',e.duration_ms,'expiresAt',e.expires_at);
end $$;

-- The reporter-owned reservation path carries the same duration; its checks
-- are otherwise unchanged.
create or replace function public.findback_reserve_chat_media_report_evidence(
 p_actor text,p_report_id text,p_source_attachment_id text,p_evidence_id text
) returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare r public.content_reports%rowtype; s public.chat_media_report_sources%rowtype;
 e public.chat_media_report_evidence%rowtype;
begin
 if p_evidence_id is null or p_evidence_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'Invalid media identity' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-media-evidence-id:'||p_evidence_id,0));
 select * into r from public.content_reports where id=p_report_id for update;
 if not found or r.target_type not in ('MESSAGE','USER')
   or r.evidence_erased_at is not null or r.evidence_expires_at::timestamptz<=clock_timestamp() then
  raise exception 'Report evidence unavailable' using errcode='42501'; end if;
 -- Before unlinking, the gateway must carry the authenticated reporter. After
 -- unlinking, only the service-owned NULL authority may continue captured work;
 -- accepting another user id would turn it into a guessable bearer authority.
 if (r.reporter_user_id is null and p_actor is not null)
    or (r.reporter_user_id is not null and r.reporter_user_id is distinct from p_actor) then
  raise exception 'Report evidence unavailable' using errcode='42501'; end if;
 select * into s from public.chat_media_report_sources where report_id=r.id
  and source_attachment_id=p_source_attachment_id for update;
 if not found then raise exception 'Report evidence unavailable' using errcode='42501'; end if;
 select * into e from public.chat_media_report_evidence
  where report_id=r.id and source_attachment_id=s.source_attachment_id for update;
 if found then
   if e.id is distinct from p_evidence_id then
    raise exception 'Report evidence unavailable' using errcode='42501'; end if;
 else
   insert into public.chat_media_report_evidence(id,report_id,source_attachment_id,source_message_id,
    object_key,sha256,mime,byte_size,width,height,duration_ms,expires_at)
   values(p_evidence_id,r.id,s.source_attachment_id,s.source_message_id,'evidence/'||gen_random_uuid()::text,
    s.sha256,s.mime,s.byte_size,s.width,s.height,s.duration_ms,r.evidence_expires_at::timestamptz)
   returning * into e;
  end if;
  return jsonb_build_object('id',e.id,'generation',e.generation,
   'sourceBucket','findback-chat-media','sourceObjectKey',s.source_object_key,
  'bucket','findback-chat-moderation-evidence','objectKey',e.object_key,
  'sha256',e.sha256,'mime',e.mime,'bytes',e.byte_size,'width',e.width,'height',e.height,
  'durationMs',e.duration_ms,'expiresAt',e.expires_at);
end $$;

-- The staff reader returns the duration too; it still never returns a bucket
-- or object key to a client.
create or replace function public.findback_read_chat_media_report_evidence(p_actor text,p_evidence_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare e public.chat_media_report_evidence%rowtype;
begin
 if not exists(select 1 from public.user_roles ur where ur.user_id=p_actor and ur.role='ADMIN')
  and not exists(select 1 from public.user_roles ur join public.user_role_capabilities uc on uc.user_id=ur.user_id
   where ur.user_id=p_actor and ur.role='MODERATOR' and uc.capability='reports_review') then
  raise exception 'Report evidence unavailable' using errcode='42501'; end if;
 select * into e from public.chat_media_report_evidence where id=p_evidence_id and state='ATTACHED'
  and expires_at>statement_timestamp();
 if not found then return null; end if;
 return jsonb_build_object('bucket','findback-chat-moderation-evidence','id',e.id,'reportId',e.report_id,
  'generation',e.generation,'objectKey',e.object_key,'sha256',e.sha256,'mime',e.mime,
  'bytes',e.byte_size,'width',e.width,'height',e.height,'durationMs',e.duration_ms,'expiresAt',e.expires_at);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The case reader projects a bounded media manifest, never a key.
-- ---------------------------------------------------------------------------
create or replace function public.findback_moderation_target(
  p_target_type text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_target jsonb;
  v_exists boolean := false;
  v_case_type text;
  v_case_id text;
begin
  if not public.findback_can('reports_review') then
    raise exception 'You may not read a moderation target' using errcode = '42501';
  end if;

  if p_target_type is null or p_target_type not in ('POST', 'COMMENT', 'USER') then
    raise exception 'Unknown moderation target type' using errcode = '22023';
  end if;
  if p_target_id is null or btrim(p_target_id) = '' then
    raise exception 'A moderation target id is required' using errcode = '22023';
  end if;

  if p_target_type = 'POST' then
    select jsonb_build_object(
             'target_type', 'POST',
             'id', p.id,
             'user_id', p.user_id,
             'type', p.type,
             'title', p.title,
             'description_excerpt', left(p.description, 500),
             'status', p.status,
             'moderation_visibility', p.moderation_visibility,
             'created_at', p.created_at
           )
      into v_target
      from public.item_posts p
     where p.id = p_target_id;
    v_exists := v_target is not null;
  elsif p_target_type = 'COMMENT' then
    select jsonb_build_object(
             'target_type', 'COMMENT',
             'id', c.id,
             'post_id', c.post_id,
             'user_id', c.user_id,
             'body_excerpt', left(c.body, 500),
             'moderation_visibility', c.moderation_visibility,
             'post_moderation_visibility', p.moderation_visibility,
             'created_at', c.created_at
           )
      into v_target
      from public.comments c
      left join public.item_posts p on p.id = c.post_id
     where c.id = p_target_id;
    v_exists := v_target is not null;
  else
    select jsonb_build_object(
             'target_type', 'USER',
             'id', u.id,
             'username', u.username,
             'display_name', u.display_name,
             'avatar_url', u.avatar_url,
             'created_at', u.created_at
           )
      into v_target
      from public.users u
     where u.id = p_target_id;
    v_exists := v_target is not null;
  end if;

  -- No live-row or expiring snapshot is needed to identify the exact case.
  v_case_type := p_target_type;
  v_case_id := p_target_id;

  return jsonb_build_object(
    'target_type', p_target_type,
    'target_id', p_target_id,
    'target_exists', v_exists,
    -- The pointer-or-absence is reported HONESTLY: a deleted target is null,
    -- never a fabricated row (the amendment's B2b consequence).
    'target', case when v_exists then v_target else null end,
    -- One decision and one reopen request, both from the resolved case above.
    -- Moderation-target readers are privileged; the decider's id is still not
    -- projected, matching the prior contract.
    'decision', (
      select jsonb_build_object(
               'action', d.decision_action,
               'generation', d.generation,
               'decided_at', d.decided_at,
               'reopened_at', d.reopened_at
             )
        from public.moderation_case_decisions d
       where d.target_type = v_case_type
         and d.target_id = v_case_id
    ),
    'reopen', (
      select jsonb_build_object(
               'appeal_id', a.id,
               'message', a.message,
               'submitted_at', a.submitted_at
             )
        from public.moderation_case_decisions d
        join public.appeals a on a.id = d.reopened_by_appeal_id
       where d.target_type = v_case_type
         and d.target_id = v_case_id
         and d.reopened_at is not null
    ),
    -- Exact-case evidence only. Snapshot expiry also bounds cleanup lag.
    'reports', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', r.id,
                 'reason', r.reason,
                 'detail', r.detail,
                 'status', r.status,
                 'created_at', r.created_at,
                 'reviewed_at', r.reviewed_at,
                 -- The read filter that bounds the cleanup lag: an expired or
                 -- erased snapshot is unavailable to moderators too (§13.11).
                 'evidence', case
                   when r.evidence_erased_at is not null then null
                   when r.evidence_expires_at <= v_now then null
                   else r.evidence_snapshot
                 end,
                 -- Metadata only: no bucket, no object key, no signed URL.
                 'media', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'evidence_id', e.id,
                              'message_id', e.source_message_id,
                              'mime', e.mime,
                              'bytes', e.byte_size,
                              'width', e.width,
                              'height', e.height,
                              'duration_ms', e.duration_ms,
                              'state', e.state,
                              'expires_at', e.expires_at
                            ) order by e.created_at, e.id
                          )
                     from public.chat_media_report_evidence e
                    where e.report_id = r.id
                 ), '[]'::jsonb)
               ) order by r.created_at desc, r.id desc
             )
        from public.content_reports r
       where r.case_type = v_case_type
         and r.case_id = v_case_id
    ), '[]'::jsonb),
    -- The canonical case's decision history for this exact atom.
    'outcomes', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'action', l.action,
                 'reason', l.reason,
                 'created_at', l.created_at
               ) order by l.created_at desc, l.id desc
             )
        from public.admin_audit_log l
        join public.moderation_case_audits ca on ca.audit_id = l.id
       where ca.case_type = v_case_type
         and ca.case_id = v_case_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. An honest staff queue count, grouped exactly like the queue.
-- ---------------------------------------------------------------------------
create function public.findback_moderation_queue_count()
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if not public.findback_can('reports_review') then
    raise exception 'You may not read the moderation queue' using errcode = '42501';
  end if;
  with report_cases as (
    select r.case_type as target_type, r.case_id as target_id
      from public.content_reports r
     where r.status in ('OPEN', 'UNDER_REVIEW') and r.case_id is not null
     group by r.case_type, r.case_id
  ), reopened_cases as (
    select d.target_type, d.target_id
      from public.moderation_case_decisions d
     where d.reopened_at is not null
  ), cases as (
    select target_type, target_id from report_cases
    union
    select target_type, target_id from reopened_cases
  )
  select count(*)::integer into v_count from cases;
  return v_count;
end;
$$;

revoke all on function public.findback_moderation_queue_count() from public, anon;
grant execute on function public.findback_moderation_queue_count() to authenticated;

comment on function public.findback_moderation_queue_count() is
  'Open moderation cases, grouped by the exact (target_type, target_id) case the queue shows. Capability-gated; the client shows a badge only when this is above zero.';

commit;
