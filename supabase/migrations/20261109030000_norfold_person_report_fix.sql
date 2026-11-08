-- 2026-11-09: person reports could not be submitted at all.
--
-- public.users.created_at is text, so `u.created_at at time zone 'utc'`
-- resolved to pg_catalog.timezone(unknown, text), which does not exist. Every
-- call raised 42883 before the receipt was written, and the client reported the
-- server as not having the function. One cast fixes the account-created copy;
-- nothing else about the writer, its bounds or its snapshot changes.
--
-- Fix-forward: 20261109010000 is applied and immutable.
begin;

create or replace function public.findback_submit_person_report(
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
         to_char(u.created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
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

commit;
