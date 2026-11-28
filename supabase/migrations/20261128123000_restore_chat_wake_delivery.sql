-- Chat push delivery after the R4 consolidation.
--
-- R4 folded the per-viewer chat projection into `chat_member_state`: the same
-- role, plus the viewer's own mute. Two wake readers were re-created afterwards
-- against the retired projection, so neither could resolve its relation and
-- every call failed before reading a row. PostgREST answered each attempt with
-- 404, the shared code classified that as retryable, and no chat wake has been
-- dispatched to FCM or Web Push since.
--
-- Both readers are restored against `chat_member_state` here. The public FCM
-- wrapper also regains the device-authority admission the same release removed:
-- a wake may only resolve a token whose installation, session and enrollment
-- generation are still admitted, so a deleted session cannot be woken. No table,
-- column, row or signature changes, and the Messages preference keeps
-- suppressing CHAT_CONNECTED wakes exactly as before.
begin;

-- Eligibility, unchanged from the mute release: the wake must still be claimed,
-- unexpired and internally consistent, the pair unblocked, the recipient in the
-- audience, and the message still current for its conversation state.
create or replace function public.findback_chat_external_wake_delivery_authority_legacy_internal(
 p_wake_id text,p_device_id text,p_claim_token text
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare w public.chat_external_wakes%rowtype; d public.chat_external_wake_devices%rowtype;
 c public.chat_conversations%rowtype; m public.chat_messages%rowtype; v_token text;
begin
 select * into d from public.chat_external_wake_devices where wake_id=p_wake_id and device_id=p_device_id;
 if not found or d.state<>'CLAIMED' or d.claim_token is distinct from p_claim_token
  or d.lease_until<=clock_timestamp() then return null; end if;
 select * into w from public.chat_external_wakes where id=p_wake_id and expires_at>clock_timestamp();
 if not found then return null; end if;
 select * into c from public.chat_conversations where id=w.conversation_id;
 select * into m from public.chat_messages where id=w.message_id and conversation_id=w.conversation_id;
 if c.id is null or m.id is null or m.unsent_at is not null or w.recipient_id not in(c.user_a,c.user_b)
  or m.sender_id not in(c.user_a,c.user_b) or m.sender_id=w.recipient_id
  or not exists(select 1 from public.chat_message_audience a where a.message_id=m.id and a.user_id=w.recipient_id)
  or public.findback_is_blocked_pair(c.user_a,c.user_b)
  or exists(select 1 from public.notification_preferences p where p.user_id=w.recipient_id and p.push_enabled=0)
  or (w.kind='CHAT_REQUEST' and (c.state<>'REQUEST' or c.request_epoch is distinct from w.request_epoch
    or not m.first_approach or not exists(select 1 from public.chat_member_state v
      where v.conversation_id=c.id and v.user_id=w.recipient_id and v.request_direction='INCOMING'
       and not v.hidden and not v.declined and not v.muted)))
  or (w.kind='CHAT_CONNECTED' and (c.state<>'CONNECTED'
    or c.receipt_connection_epoch is distinct from w.connection_epoch
    or exists(select 1 from public.notification_preferences p
      where p.user_id=w.recipient_id and p.messages=0))) then return null; end if;
 select token into v_token from public.device_tokens where id=p_device_id and user_id=w.recipient_id;
 if v_token is null then return null; end if;
 return jsonb_build_object('wakeId',w.id,'recipientId',w.recipient_id,'conversationId',w.conversation_id,
  'kind',w.kind,'token',v_token);
end $$;

-- Service-side admission, not an everlasting grant: the token row is resolved
-- first, and the send is refused unless the device authority still admits it.
create or replace function public.findback_chat_external_wake_delivery(
 p_wake_id text,p_device_id text,p_claim_token text
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare d public.device_tokens%rowtype; begin
 select * into d from public.device_tokens where id=p_device_id;
 if not found or not public.findback_device_push_allowed(d.user_id,d.token) then return null; end if;
 return public.findback_chat_external_wake_delivery_authority_legacy_internal(p_wake_id,p_device_id,p_claim_token);
end $$;

-- The browser lane answers to the same eligibility rules, so a blocked pair, a
-- declined request, a muted viewer, an unsent message or a disabled preference
-- suppresses both channels identically. Columns, ordering and the clamp are
-- unchanged.
create or replace function public.findback_web_push_wakes(p_limit integer default 50)
returns table (
  wake_id text,
  recipient_id text,
  conversation_id text,
  kind text,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  return query
  select w.id, w.recipient_id, w.conversation_id, w.kind, s.endpoint, s.p256dh, s.auth
  from public.chat_external_wakes w
  join public.chat_conversations c on c.id = w.conversation_id
  join public.chat_messages m on m.id = w.message_id and m.conversation_id = w.conversation_id
  join public.web_push_subscriptions s on s.user_id = w.recipient_id
  where w.web_notified_at is null
    and w.expires_at > clock_timestamp()
    and m.unsent_at is null
    and w.recipient_id in (c.user_a, c.user_b)
    and m.sender_id in (c.user_a, c.user_b)
    and m.sender_id <> w.recipient_id
    and exists (
      select 1 from public.chat_message_audience a
      where a.message_id = m.id and a.user_id = w.recipient_id
    )
    and not public.findback_is_blocked_pair(c.user_a, c.user_b)
    and exists (
      select 1 from public.notification_preferences p
      where p.user_id = w.recipient_id and p.push_enabled = 1
    )
    and (w.kind <> 'CHAT_CONNECTED' or exists (
      select 1 from public.notification_preferences p
      where p.user_id = w.recipient_id and p.messages = 1
    ))
    and (w.kind <> 'CHAT_CONNECTED' or (
      c.state = 'CONNECTED' and c.receipt_connection_epoch is not distinct from w.connection_epoch
    ))
    and (w.kind <> 'CHAT_REQUEST' or (
      c.state = 'REQUEST'
      and c.request_epoch is not distinct from w.request_epoch
      and m.first_approach
      and exists (
        select 1 from public.chat_member_state v
        where v.conversation_id = c.id and v.user_id = w.recipient_id
          and v.request_direction = 'INCOMING' and not v.hidden and not v.declined
          and not v.muted
      )
    ))
  order by w.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.findback_chat_external_wake_delivery(text,text,text), public.findback_chat_external_wake_delivery_authority_legacy_internal(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.findback_chat_external_wake_delivery(text,text,text) to service_role;
revoke all on function public.findback_web_push_wakes(integer) from public, anon, authenticated;
grant execute on function public.findback_web_push_wakes(integer) to service_role;

commit;
