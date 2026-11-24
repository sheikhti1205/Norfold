-- R3, second half: the contact rules from
-- 20261112160000 were stored and re-read but nothing consulted them, so the
-- settings panel offered a control the product did not honour.
--
-- Where the rule applies
--   A first approach in this schema *is* a connection request: a conversation
--   carries no other inbound object before it is CONNECTED. So the recipient's
--   `message_from` and `connect_from` both decide one event - whether a stranger
--   may open contact. `show_contact` gates contact details, and no client path
--   exposes email or phone (20260920000000 grants only safe profile columns),
--   so there is nothing for it to gate yet and this migration does not pretend
--   otherwise.
--
-- How a refusal behaves
--   Exactly like the existing block path: the row is stored, the author sees
--   their own copy, the recipient is never told anything. Nothing raises, so a
--   stranger cannot use the error to read an account's settings.
--
-- Scope
--   Only new first approaches. Threads that are already CONNECTED are untouched,
--   and an account that never saved a rule stays permissive because the
--   function treats "no row" as ANYONE.

begin;

-- True when `p_recipient` accepts an approach from an unknown account.
-- `ANYONE` permits; `CONNECTED` and `NOBODY` both refuse a stranger, because a
-- first approach is by definition not from an established connection. An
-- account that has been reached before is not a stranger: it is proven by a
-- message in this conversation that was written while the pair was CONNECTED
-- (that epoch is cleared on every boundary, so the row is the lasting proof).
create or replace function public.findback_contact_permits_internal(
  p_recipient text, p_conversation text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.account_contact_rules%rowtype;
begin
  select * into r from public.account_contact_rules where user_id = p_recipient;
  if not found then return true; end if;
  if r.message_from = 'ANYONE' and r.connect_from = 'ANYONE' then return true; end if;
  if r.message_from = 'NOBODY' or r.connect_from = 'NOBODY' then return false; end if;
  return exists(select 1 from public.chat_messages m
    where m.conversation_id = p_conversation and m.receipt_connection_epoch is not null);
end $$;

revoke all on function public.findback_contact_permits_internal(text,text) from public, anon, authenticated;
comment on function public.findback_contact_permits_internal(text,text) is
  'Admission predicate: may p_recipient be approached by a stranger in this conversation? Read by the message send path.';

-- The send owner, unchanged except for the contact-rule gate below. Everything
-- before it (payload identity, replay, epoch binding, type/state rules) and
-- everything after it (insert, echo enqueue) is identical to 20261109020000.
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
 -- R3: a first approach is admitted only when the recipient's contact rules
 -- allow a stranger. Refusal joins the block path instead of raising, so the
 -- outcome is indistinguishable from a blocked pair and cannot be probed.
 if c.state='REQUEST' and not v_blocked then
  v_blocked:=not public.findback_contact_permits_internal(v_peer,c.id);
 end if;
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
 -- A withheld (blocked or refused) send still echoes to the author and never
 -- occupies the counterpart's request slot; media reservation refuses it
 -- separately.
 perform public.findback_enqueue_chat_mailbox(p_client_message_id);
 return p_client_message_id;
end $$;

-- Recreated functions start PUBLIC-executable; close them exactly as the
-- existing sweeps do.
revoke all on function public.findback_chat_send_internal(text,text,text,text,text,jsonb)
 from public,anon,authenticated;

comment on function public.findback_chat_send_internal(text,text,text,text,text,jsonb) is
 'Single message admission for every message type. A first approach in REQUEST state is withheld unless the recipient''s contact rules permit a stranger.';

commit;
