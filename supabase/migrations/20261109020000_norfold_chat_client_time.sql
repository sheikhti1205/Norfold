-- 2026-11-09: preserve the sender's composition instant across devices.
--
-- LIVE-PENDING: apply and probe with supabase/tests/verify_norfold_chat_client_time.sql.
-- ADDITIVE ONLY: one nullable column; every existing row keeps NULL and every
-- envelope falls back to sent_at, so pre-existing clients and rows are unchanged.
--
-- Why: a batch of photos is one gesture. Without a transported instant the
-- sender groups by local enqueue time while a receiver groups by its own apply
-- time, so the same send renders grouped on one device and split on the other.
-- createdAt travels in SEND's context, is bounded server-side, is stored beside
-- the message, and is exposed by the mailbox projection that conversation sync
-- already reuses. Payload identity is deliberately untouched: a retry of the
-- same client id may carry the same instant, and a changed instant never
-- authorizes new content.
begin;

alter table public.chat_messages add column if not exists client_sent_at timestamptz;

create or replace function public.findback_chat_send_internal(
  p_conversation_id text, p_body text, p_client_message_id text, p_message_type text,
  p_expected_epoch text, p_context jsonb default '{}'::jsonb
) returns text language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_uid text:=auth.uid()::text; c public.chat_conversations%rowtype; m public.chat_messages%rowtype;
 v_digest text; v_first boolean; v_epoch text; v_blocked boolean; v_peer text;
 v_report text; v_lat double precision; v_lng double precision; v_accuracy double precision;
 v_reply text;
  v_identity text;
  v_client timestamptz;
begin
 if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 if p_message_type is null or p_message_type not in ('TEXT','MEDIA','LOCATION','VOICE') then
  raise exception 'Invalid message type' using errcode='22023'; end if;
 if p_client_message_id is null
  or p_client_message_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  raise exception 'Invalid message' using errcode='22023'; end if;
 p_body:=coalesce(p_body,'');
 if length(p_body)>100000 or (p_message_type='TEXT' and btrim(p_body)='') then
  raise exception 'Invalid message' using errcode='22023'; end if;
 if p_context is null or jsonb_typeof(p_context)<>'object' then
  raise exception 'Invalid message' using errcode='22023'; end if;
 v_report:=nullif(p_context->>'reportId','');
 -- A reply names one existing message in this same conversation. It is not part
 -- of payload identity: a retry of one client id always carries the same reply,
 -- so an accepted message stays idempotent while the reference is stored once.
 v_reply:=nullif(p_context->>'replyToId','');
 -- The composition instant is presentation metadata, not payload identity: a
 -- retry of the same client id may carry it again and the digest is unchanged.
 -- A claim outside one week back / one minute ahead is not credible, so such a
 -- row falls back to the server's own sent_at instead of rewriting history.
 if p_context->>'createdAt' ~ '^[0-9]{1,15}$' then
  v_client:=to_timestamp((p_context->>'createdAt')::bigint/1000.0);
  if v_client < clock_timestamp() - interval '7 days'
   or v_client > clock_timestamp() + interval '60 seconds' then
   v_client:=null; end if;
 end if;
 -- Shape and bounds are payload validity, not visibility: a retry of an
 -- accepted message must clear them without re-reading the report.
 if v_report is not null and p_message_type<>'TEXT' then
  raise exception 'Invalid message' using errcode='22023'; end if;
 if p_message_type='LOCATION' then
  if jsonb_typeof(p_context->'location') is distinct from 'object' then
   raise exception 'Location required' using errcode='22023'; end if;
  v_lat:=(p_context->'location'->>'lat')::double precision;
  v_lng:=(p_context->'location'->>'lng')::double precision;
  v_accuracy:=(p_context->'location'->>'accuracy')::double precision;
   if v_lat is null or v_lng is null
   or v_lat not between -90 and 90 or v_lng not between -180 and 180
   or v_accuracy<=0 or v_accuracy>100000 then
   raise exception 'Location required' using errcode='22023'; end if;
 elsif jsonb_typeof(p_context->'location') is not null then
  raise exception 'Invalid message' using errcode='22023'; end if;
 select * into c from public.chat_conversations where id=p_conversation_id and v_uid in(user_a,user_b) for update;
 if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 if v_reply is not null and not exists(select 1 from public.chat_messages t
  where t.id=v_reply and t.conversation_id=c.id) then
  raise exception 'Invalid reply target' using errcode='22023'; end if;
 v_digest:=encode(sha256(convert_to(p_body,'UTF8')),'hex');
 -- Length-prefixed body + exact coordinate bytes: injective over the payload, so
 -- digest equality IS payload equality. No delimiter inside a body can be read
 -- as structure and no two distinct fixes round to the same identity.
 v_identity:=public.findback_chat_payload_identity(p_body,p_message_type,v_report,v_lat,v_lng,v_accuracy);
 select * into m from public.chat_messages where id=p_client_message_id;
 if found then
  -- Replay is state-independent and content-independent: a lost response must
  -- stay retryable after the conversation moves on, after an Unsend, and after
  -- the referenced report disappears. The digest already binds body, type,
  -- report context and coordinates, so an identical payload resolves to the
  -- accepted id while any recast is still a conflict.
  -- Reconstructable legacy rows were backfilled above. A NULL identity is
  -- unrecoverable legacy content, never authority for a digest-only recast.
  if m.sender_id=v_uid and m.conversation_id=c.id and m.message_type=p_message_type
   and m.payload_identity=v_identity then
   return m.id; end if;
  raise exception 'Message identity conflict' using errcode='22023';
 end if;
 -- New work must attach a report the author can still read. Live visibility,
 -- not a copied snapshot: every later reader resolves availability again.
 if v_report is not null and not public.findback_can_read_post(v_report) then
  raise exception 'Report unavailable' using errcode='42501'; end if;
 -- New work must bind to the boundary the client actually observed. A retry of
 -- an already-accepted message returned above and stays idempotent.
 if p_expected_epoch is null
  or p_expected_epoch is distinct from public.findback_chat_relationship_epoch(c) then
  raise exception 'Conversation unavailable' using errcode='42501'; end if;
 if c.state not in ('REQUEST','CONNECTED') then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 -- MEDIA and LOCATION are connection-only capabilities; neither is request-stage.
 if p_message_type in ('MEDIA','LOCATION','VOICE') and c.state<>'CONNECTED' then
  raise exception 'Conversation unavailable' using errcode='42501'; end if;
 if c.state='REQUEST' and c.initiated_by is not null and c.initiated_by<>v_uid then
  raise exception 'Conversation unavailable' using errcode='42501'; end if;
 v_peer:=case when c.user_a=v_uid then c.user_b else c.user_a end;
 v_blocked:=public.findback_is_blocked_pair(c.user_a,c.user_b);
 v_first:=false;
 if c.state='REQUEST' then
  -- The request identity is created with the conversation and regenerated at
  -- every boundary, so a second queued text in the same request stays valid.
  v_epoch:=c.request_epoch;
  if v_epoch is null then
   v_epoch:=gen_random_uuid()::text;
   update public.chat_conversations set request_epoch=v_epoch where id=c.id;
  end if;
  v_first:=not v_blocked and not c.request_nudged;
  perform public.findback_chat_publish_member(c.id,v_uid,'REQUEST','OUTGOING',v_epoch);
  if not v_blocked then
   if exists(select 1 from public.chat_preferences where user_id=v_peer and open_messages) then
    -- Opt-in authorizes this actual contact only; it never bulk-accepts pairs.
    update public.chat_conversations set state='CONNECTED',initiated_by=v_uid,request_epoch=v_epoch,
     request_nudged=true,updated_at=clock_timestamp() where id=c.id;
    perform public.findback_chat_publish_member(c.id,v_uid,'CONNECTED','NONE',null);
    perform public.findback_chat_publish_member(c.id,v_peer,'CONNECTED','NONE',null);
   else
    update public.chat_conversations set initiated_by=v_uid,request_epoch=v_epoch,request_nudged=true
     where id=c.id;
    perform public.findback_chat_publish_member(c.id,v_peer,'REQUEST','INCOMING',v_epoch);
   end if;
  end if;
 end if;
 -- The message that triggers open-inbox auto-connect stays request-origin, so it
 -- never becomes receipt-eligible in the new connection.
 insert into public.chat_messages(id,conversation_id,sender_id,body,payload_digest,payload_identity,
  first_approach,message_type,receipt_connection_epoch,context_report_id,location_lat,location_lng,location_accuracy_m,reply_to_id,client_sent_at)
 values(p_client_message_id,c.id,v_uid,p_body,v_digest,v_identity,v_first,p_message_type,
  case when c.state='CONNECTED' then c.receipt_connection_epoch else null end,
  v_report,v_lat,v_lng,v_accuracy,v_reply,v_client);
 -- A withheld (blocked) send still echoes to the author and never occupies the
 -- counterpart's request slot; media reservation refuses it separately.
 perform public.findback_enqueue_chat_mailbox(p_client_message_id);
 return p_client_message_id;
end $$;

create or replace function public.findback_chat_mailbox_internal(p_device text,p_ids text[]) returns setof jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u text:=auth.uid()::text;
begin
 if u is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 return query select jsonb_build_object('accountId',u,'deviceId',p_device,'mailboxId',b.id,
  'event',jsonb_build_object('kind','TEXT','eventId',m.id,'sequence',m.event_sequence,
   'serverTime',floor(extract(epoch from m.sent_at)*1000)::bigint,'message',
   jsonb_build_object('id',m.id,'conversationId',c.id,'authorId',m.sender_id,
    'recipientId',case when c.user_a=m.sender_id then c.user_b else c.user_a end,
    'body',m.body,'messageType',m.message_type,
    'createdAt',coalesce(round(extract(epoch from m.client_sent_at)*1000)::bigint,
     round(extract(epoch from m.sent_at)*1000)::bigint))
    ||case when m.context_report_id is null then '{}'::jsonb else jsonb_build_object('contextReportId',m.context_report_id) end
    ||case when m.reply_to_id is null then '{}'::jsonb else jsonb_build_object('replyToId',m.reply_to_id) end
    ||case when m.message_type='LOCATION' then jsonb_build_object('location',jsonb_build_object('lat',m.location_lat,'lng',m.location_lng,'accuracy',m.location_accuracy_m)) else '{}'::jsonb end))
 from public.chat_mailbox b join public.chat_devices d on d.id=b.device_id
 join public.chat_messages m on m.id=b.message_id join public.chat_conversations c on c.id=b.conversation_id
 where d.user_id=u and d.device_id=p_device and b.acked_at is null and b.expires_at>clock_timestamp()
  and (p_ids is null or m.id=any(p_ids)) and m.unsent_at is null and (m.body<>'' or m.message_type in('MEDIA','LOCATION','VOICE'))
  and (m.sender_id=u or not public.findback_is_blocked_pair(c.user_a,c.user_b))
  and (m.sender_id=u or m.message_type not in('MEDIA','VOICE') or exists(select 1 from public.chat_media_attachments a
   where a.message_id=m.id and public.findback_chat_media_visible_internal(u,a.id)))
 order by m.event_sequence limit 100;
end $$;

create or replace function public.findback_chat_exchange(p_account_id text,p_device_id text,p_action text,p_args jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_uid text:=auth.uid()::text; v_result jsonb; v_other text; v_after bigint; v_id text; v_head jsonb;
begin
 if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 if p_account_id is null or p_account_id<>v_uid then raise exception 'Session changed' using errcode='42501'; end if;
 case p_action
 when 'HEAD' then return public.findback_chat_head_internal(v_uid,p_device_id,p_args->>'conversationId');
 when 'CONVERSATION_SYNC' then return public.findback_chat_conversation_sync_internal(v_uid,p_device_id,p_args->'head',(p_args->>'afterPosition')::bigint);
 when 'REGISTER' then return to_jsonb(public.findback_register_chat_device(p_device_id,p_args->>'platform'));
 when 'VIEWS' then return public.findback_chat_views(p_args->>'afterId');
 when 'PRIVATE' then perform public.findback_chat_private_state(p_args->>'conversationId',p_args->>'operation');
 when 'CREATE' then return to_jsonb(public.findback_create_conversation(p_args->>'otherId'));
 when 'ACCEPT' then perform public.findback_accept_conversation(p_args->>'conversationId',p_args->>'expectedEpoch');
 when 'END' then perform public.findback_end_conversation(p_args->>'conversationId');
 when 'BLOCK' then perform public.findback_block_conversation(p_args->>'conversationId');
 when 'RECEIPTS' then perform public.findback_set_chat_receipts((p_args->>'enabled')::boolean);
 when 'PREFERENCES' then
  select jsonb_build_object('readReceipts',coalesce((select enabled from public.chat_preferences where user_id=v_uid),false),
   'openMessages',coalesce((select open_messages from public.chat_preferences where user_id=v_uid),false)) into v_result;
  return v_result;
 when 'CONTACT_MODE' then
  if jsonb_typeof(p_args->'enabled') is distinct from 'boolean' then raise exception 'Preference required' using errcode='22023'; end if;
  insert into public.chat_preferences(user_id,open_messages) values(v_uid,(p_args->>'enabled')::boolean)
   on conflict(user_id) do update set open_messages=excluded.open_messages;
 when 'SEND' then
  if not exists(select 1 from public.chat_devices where user_id=v_uid and device_id=p_device_id) then
   raise exception 'Device unavailable' using errcode='42501'; end if;
  select case when user_a=v_uid then user_b else user_a end into v_other from public.chat_conversations
   where id=p_args->>'conversationId' and v_uid in(user_a,user_b) for update;
  if not found or (p_args->>'recipientId') is distinct from v_other then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  -- Stable accepted IDs remain replayable after a boundary; immutable payload
  -- validation is still performed by the canonical send owner below.
  if not exists(select 1 from public.chat_messages
   where id=p_args->>'messageId' and conversation_id=p_args->>'conversationId' and sender_id=v_uid) then
   v_head:=public.findback_chat_head_internal(v_uid,p_device_id,p_args->>'conversationId');
   if jsonb_typeof(p_args->'expectedHead') is distinct from 'object'
    or (v_head-'serverTime') is distinct from ((p_args->'expectedHead')-'serverTime') then
    raise exception 'Conversation changed' using errcode='40001'; end if;
  end if;
  return to_jsonb(public.findback_chat_send_internal(p_args->>'conversationId',p_args->>'body',p_args->>'messageId',
   coalesce(p_args->>'messageType','TEXT'),p_args->>'expectedEpoch',
   jsonb_strip_nulls(jsonb_build_object('reportId',p_args->>'contextReportId','location',p_args->'location',
    'replyToId',p_args->>'replyToId','createdAt',p_args->>'createdAt'))));
 when 'SYNC' then
  select coalesce(jsonb_agg(e),'[]'::jsonb) into v_result from public.findback_fetch_chat_mailbox(p_device_id) e;
  return v_result;
 when 'ACK' then perform public.findback_ack_chat_message(p_args->>'mailboxId',p_device_id);
 when 'STATE_SYNC' then
  if not exists(select 1 from public.chat_devices where user_id=v_uid and device_id=p_device_id) then raise exception 'Device unavailable' using errcode='42501'; end if;
  v_after:=(p_args->>'afterSequence')::bigint;
  if v_after is null or v_after<0 or v_after>9007199254740991 then raise exception 'Invalid state cursor' using errcode='22023'; end if;
  select coalesce(jsonb_agg(page.value order by page.seq),'[]'::jsonb) into v_result from (
   select e.event_sequence as seq,jsonb_build_object('accountId',v_uid,'deviceId',p_device_id,'change',
    jsonb_build_object('eventId',e.id,'sequence',e.event_sequence,'kind',e.kind,'conversationId',e.conversation_id,
     'occurredAt',floor(extract(epoch from e.occurred_at)*1000)::bigint)||case when e.kind='CLEAR_FOR_ME'
     then jsonb_build_object('peerId',e.peer_id,'throughSequence',e.through_sequence)
     else jsonb_build_object('messageId',e.message_id,'authorId',e.author_id,'recipientId',e.recipient_id,'messageSequence',e.message_sequence) end) as value
   from public.chat_state_events e join public.chat_state_audience a on a.event_id=e.id
   where a.user_id=v_uid and e.event_sequence>v_after order by e.event_sequence limit 100
  ) page;
  return v_result;
 when 'STATE_ACK' then
  if not exists(select 1 from public.chat_devices where user_id=v_uid and device_id=p_device_id) then raise exception 'Device unavailable' using errcode='42501'; end if;
  v_after:=(p_args->>'sequence')::bigint;
  if not exists(select 1 from public.chat_state_events e join public.chat_state_audience a on a.event_id=e.id
   where e.id=p_args->>'eventId' and e.event_sequence=v_after and a.user_id=v_uid) then raise exception 'State unavailable' using errcode='42501'; end if;
  update public.chat_devices set state_ack_sequence=greatest(state_ack_sequence,v_after) where user_id=v_uid and device_id=p_device_id;
 when 'UNSEND','DELETE_FOR_ME','CLEAR_FOR_ME' then
  if not exists(select 1 from public.chat_devices where user_id=v_uid and device_id=p_device_id) then raise exception 'Device unavailable' using errcode='42501'; end if;
  v_id:=public.findback_chat_remove(p_action,p_args->>'conversationId',p_args->>'messageId',(p_args->>'throughSequence')::bigint);
  return to_jsonb(v_id);
 else raise exception 'Invalid chat operation' using errcode='22023';
 end case;
 return 'null'::jsonb;
end $$;


-- Recreated functions start PUBLIC-executable; close them exactly as the
-- existing sweeps do.
revoke all on function public.findback_chat_send_internal(text,text,text,text,text,jsonb)
 from public,anon,authenticated;
revoke all on function public.findback_chat_mailbox_internal(text,text[]) from public,anon,authenticated,service_role;
revoke all on function public.findback_chat_exchange(text,text,text,jsonb) from public,anon;
grant execute on function public.findback_chat_exchange(text,text,text,jsonb) to authenticated;

commit;
