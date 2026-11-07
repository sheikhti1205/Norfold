-- Voice notes: a real message classification whose bytes ride the existing
-- verified chat-media attachment path.
--
-- A note is not photo `MEDIA` with a caption: it has its own type, its own
-- container allowlist and a measured duration. Everything security-relevant is
-- unchanged — the same connection/block/epoch gate, the same trusted gateway,
-- the same device authority, the same private storage policy.
begin;

-- `VOICE` is a classification, not a payload variant. The CHECK cannot be
-- altered in place, so the same two-transaction swap the image/LOCATION waves
-- use keeps the validation scan out of the ACCESS EXCLUSIVE window.
alter table public.chat_messages drop constraint if exists chat_messages_message_type_check;
alter table public.chat_messages add constraint chat_messages_message_type_check
 check (message_type in ('TEXT','MEDIA','LOCATION','VOICE')) not valid;
commit;

begin;
alter table public.chat_messages validate constraint chat_messages_message_type_check;
commit;

begin;

-- Audio containers are stored without their codecs parameter, so the const
-- allowlist is the container identity. Width/height keep the attachment
-- contract's positive dimensions with the sentinel 1x1 for audio (the client
-- contract documents this); `duration_ms` is what a voice row must carry.
alter table public.chat_media_attachments drop constraint if exists chat_media_attachments_mime_check;
alter table public.chat_media_attachments add constraint chat_media_attachments_mime_check
 check (mime in ('image/jpeg','image/png','image/webp','audio/webm','audio/mp4')) not valid;

-- The column must exist before the replacement row-shape CHECK names it.
alter table public.chat_media_attachments add column if not exists duration_ms integer
 check (duration_ms is null or duration_ms between 500 and 300000);

alter table public.chat_media_attachments drop constraint if exists chat_media_attachments_check;
alter table public.chat_media_attachments add constraint chat_media_attachments_kind_check
 check (
  (state='PENDING' and sha256 is null and mime is null and byte_size is null
    and width is null and height is null and duration_ms is null)
  or (state='ATTACHED' and sha256 is not null and mime is not null and byte_size is not null
    and width is not null and height is not null
    and ((mime like 'audio/%') = (duration_ms is not null))
    and (mime not like 'audio/%' or (width = 1 and height = 1)))
 ) not valid;

commit;

begin;
alter table public.chat_media_attachments validate constraint chat_media_attachments_mime_check;
alter table public.chat_media_attachments validate constraint chat_media_attachments_kind_check;
commit;

-- A reported voice note is copied to moderation evidence through the same
-- capture trigger as a photo, so those two copies must accept the audio
-- containers. Their dimension contract is unchanged: a voice row carries the
-- 1x1 sentinel, which both tables already admit.
begin;
alter table public.chat_media_report_sources drop constraint if exists chat_media_report_sources_mime_check;
alter table public.chat_media_report_sources add constraint chat_media_report_sources_mime_check
 check (mime in ('image/jpeg','image/png','image/webp','audio/webm','audio/mp4')) not valid;
alter table public.chat_media_report_evidence drop constraint if exists chat_media_report_evidence_mime_check;
alter table public.chat_media_report_evidence add constraint chat_media_report_evidence_mime_check
 check (mime in ('image/jpeg','image/png','image/webp','audio/webm','audio/mp4')) not valid;
commit;

begin;
alter table public.chat_media_report_sources validate constraint chat_media_report_sources_mime_check;
alter table public.chat_media_report_evidence validate constraint chat_media_report_evidence_mime_check;
commit;

-- Mailbox and conversation-sync delivery admit a content-free voice message
-- exactly as they admit a caption-less photo: the classification, not the body,
-- carries the payload. The media-visibility gate widens with it so a recipient
-- never receives a voice envelope whose attachment they cannot read.
begin;
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
    'body',m.body,'messageType',m.message_type)
    ||case when m.context_report_id is null then '{}'::jsonb else jsonb_build_object('contextReportId',m.context_report_id) end
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
commit;

begin;

-- One measured length travels with the attachment, not in the message body: a
-- body is user text and is erased on content erasure, while the media row is
-- the durable attachment identity.
create or replace function public.findback_read_chat_media(p_actor text,p_attachment_id text)
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare c_id text; a public.chat_media_attachments%rowtype;
begin
 select conversation_id into c_id from public.chat_media_attachments where id=p_attachment_id;
 perform 1 from public.chat_conversations where id=c_id for update;
 if not public.findback_chat_media_visible_internal(p_actor,p_attachment_id) then return null; end if;
 select * into a from public.chat_media_attachments where id=p_attachment_id;
 return jsonb_build_object('bucket','findback-chat-media','id',a.id,'messageId',a.message_id,
  'generation',a.generation,'objectKey',a.object_key,'sha256',a.sha256,
  'mime',a.mime,'bytes',a.byte_size,'width',a.width,'height',a.height,
  'durationMs',a.duration_ms,'expiresAt',a.expires_at);
end $$;
revoke all on function public.findback_read_chat_media(text,text) from public,anon,authenticated;
grant execute on function public.findback_read_chat_media(text,text) to service_role;

-- Delivery discovery carries the same duration so a receiving device renders
-- an honest length before any byte is downloaded.
create or replace function public.findback_fetch_chat_media_delivery_authority_legacy_internal(p_account_id text,p_device_id text)
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_uid text:=auth.uid()::text; v_device text; result jsonb;
begin
 if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 if p_account_id is distinct from v_uid then raise exception 'Session changed' using errcode='42501'; end if;
 select id into v_device from public.chat_devices where user_id=v_uid and device_id=p_device_id;
 if not found then raise exception 'Device unavailable' using errcode='42501'; end if;
 select coalesce(jsonb_agg(page.payload order by page.created_at,page.id),'[]'::jsonb) into result from (
  select a.id,a.created_at,jsonb_build_object('version',1,'attachmentId',a.id,'messageId',a.message_id,
   'sha256',a.sha256,'mime',a.mime,'bytes',a.byte_size,'width',a.width,'height',a.height,
   'durationMs',a.duration_ms,'expiresAt',a.expires_at) payload
  from public.chat_media_attachments a
  join public.chat_message_audience u on u.message_id=a.message_id and u.user_id=v_uid
  where public.findback_chat_media_visible_internal(v_uid,a.id)
   and not exists(select 1 from public.chat_media_delivery_receipts r where r.device_id=v_device and r.attachment_id=a.id)
  order by a.created_at,a.id limit 100
 ) page;
 return result;
end $$;
revoke all on function public.findback_fetch_chat_media_delivery_authority_legacy_internal(text,text) from public,anon,authenticated,service_role;

-- The trusted gateway asserts the measured duration exactly as it asserts the
-- digest and dimensions; clients can never certify their own length.
drop function if exists public.findback_commit_chat_media_for_device(text,uuid,text,uuid,text,text,text,text,text,integer,integer,integer);
drop function if exists public.findback_commit_chat_media(text,text,text,text,text,text,integer,integer,integer);

create function public.findback_commit_chat_media(p_actor text,p_attachment_id text,p_generation text,p_object_key text,p_sha text,p_mime text,p_bytes integer,p_width integer,p_height integer,p_duration_ms integer default null)
returns void language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare a public.chat_media_attachments%rowtype;
begin
 perform public.findback_chat_media_upload_target(p_actor,p_attachment_id);
 select * into a from public.chat_media_attachments where id=p_attachment_id for update;
 if a.generation is distinct from p_generation or a.object_key is distinct from p_object_key then
  raise exception 'Media unavailable' using errcode='42501'; end if;
 if (p_mime like 'audio/%') <> (p_duration_ms is not null) then
  raise exception 'Media unavailable' using errcode='42501'; end if;
 if a.state='ATTACHED' then
  if a.sha256 is distinct from p_sha or a.mime is distinct from p_mime or a.byte_size is distinct from p_bytes
   or a.width is distinct from p_width or a.height is distinct from p_height
   or a.duration_ms is distinct from p_duration_ms then
   raise exception 'Media unavailable' using errcode='42501'; end if;
  return;
 end if;
 update public.chat_media_attachments set state='ATTACHED',sha256=p_sha,mime=p_mime,byte_size=p_bytes,width=p_width,height=p_height,
  duration_ms=p_duration_ms,expires_at=clock_timestamp()+interval '30 days' where id=p_attachment_id;
end $$;
revoke all on function public.findback_commit_chat_media(text,text,text,text,text,text,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.findback_commit_chat_media(text,text,text,text,text,text,integer,integer,integer,integer) to service_role;

create function public.findback_commit_chat_media_for_device(p_actor text,p_session uuid,p_device text,p_enrollment uuid,
 p_attachment_id text,p_generation text,p_object_key text,p_sha text,p_mime text,p_bytes integer,p_width integer,p_height integer,p_duration_ms integer default null)
returns void language plpgsql volatile security definer set search_path=public,pg_temp as $$ declare ctx jsonb; begin
 perform public.findback_device_lock_internal(p_actor,false);
 ctx:=public.findback_device_context_internal(p_actor,p_session,p_device);
 if p_enrollment is null or p_enrollment is distinct from (ctx->>'generation')::uuid then raise exception 'Device unavailable' using errcode='42501'; end if;
 perform public.findback_commit_chat_media(p_actor,p_attachment_id,p_generation,p_object_key,p_sha,p_mime,p_bytes,p_width,p_height,p_duration_ms);
end $$;
revoke all on function public.findback_commit_chat_media_for_device(text,uuid,text,uuid,text,text,text,text,text,integer,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.findback_commit_chat_media_for_device(text,uuid,text,uuid,text,text,text,text,text,integer,integer,integer,integer) to service_role;

create or replace function public.findback_chat_send_internal(
  p_conversation_id text, p_body text, p_client_message_id text, p_message_type text,
  p_expected_epoch text, p_context jsonb default '{}'::jsonb
) returns text language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_uid text:=auth.uid()::text; c public.chat_conversations%rowtype; m public.chat_messages%rowtype;
 v_digest text; v_first boolean; v_epoch text; v_blocked boolean; v_peer text;
 v_report text; v_lat double precision; v_lng double precision; v_accuracy double precision;
  v_identity text;
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
  first_approach,message_type,receipt_connection_epoch,context_report_id,location_lat,location_lng,location_accuracy_m)
 values(p_client_message_id,c.id,v_uid,p_body,v_digest,v_identity,v_first,p_message_type,
  case when c.state='CONNECTED' then c.receipt_connection_epoch else null end,
  v_report,v_lat,v_lng,v_accuracy);
 -- A withheld (blocked) send still echoes to the author and never occupies the
 -- counterpart's request slot; media reservation refuses it separately.
 perform public.findback_enqueue_chat_mailbox(p_client_message_id);
 return p_client_message_id;
end $$;
revoke all on function public.findback_chat_send_internal(text,text,text,text,text,jsonb)
 from public,anon,authenticated;

commit;
