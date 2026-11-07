-- Forward migration: a first-class Messages notification preference.
--
-- Connected-conversation messages previously had no user-level switch: only
-- the global push toggle and per-conversation mute existed. This adds
-- `messages` (default on) and wires it into the external-wake delivery check so
-- a disabled preference suppresses the OS notification without affecting the
-- durable message itself.
begin;

alter table public.notification_preferences
  add column if not exists messages integer not null default 1 check (messages in (0, 1));

create or replace function public.findback_get_notification_preferences_client()
returns table (
  push_enabled integer,
  likes integer,
  comments integer,
  mentions integer,
  status integer,
  messages integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := auth.uid()::text;
  v_push integer;
  v_likes integer;
  v_comments integer;
  v_mentions integer;
  v_status integer;
  v_messages integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select p.push_enabled, p.likes, p.comments, p.mentions, p.status, p.messages
  into v_push, v_likes, v_comments, v_mentions, v_status, v_messages
  from public.notification_preferences p
  where p.user_id = v_uid;
  if not found then
    return query select 1, 1, 1, 1, 1, 1;
  else
    return query select v_push, v_likes, v_comments, v_mentions, v_status, v_messages;
  end if;
end;
$$;

create or replace function public.findback_set_notification_preferences_client(
  p_push_enabled boolean,
  p_likes boolean,
  p_comments boolean,
  p_mentions boolean,
  p_status boolean,
  p_messages boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := auth.uid()::text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  insert into public.notification_preferences
    (user_id, push_enabled, likes, comments, mentions, status, messages, updated_at)
  values (
    v_uid,
    (p_push_enabled)::int, (p_likes)::int, (p_comments)::int, (p_mentions)::int, (p_status)::int,
    (coalesce(p_messages, true))::int,
    v_now
  )
  on conflict (user_id) do update set
    push_enabled = excluded.push_enabled,
    likes = excluded.likes,
    comments = excluded.comments,
    mentions = excluded.mentions,
    status = excluded.status,
    messages = excluded.messages,
    updated_at = excluded.updated_at;
end;
$$;

-- Connected messages obey the new preference. Requests keep their existing
-- policy: the first approach is not silenced by the Messages switch.
create or replace function public.findback_chat_external_wake_delivery(p_wake_id text,p_device_id text,p_claim_token text)
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare w public.chat_external_wakes%rowtype; d public.chat_external_wake_devices%rowtype;
 c public.chat_conversations%rowtype; m public.chat_messages%rowtype; v_token text;
begin
 select * into d from public.chat_external_wake_devices where wake_id=p_wake_id and device_id=p_device_id;
 if not found or d.state<>'CLAIMED' or d.claim_token is distinct from p_claim_token or d.lease_until<=clock_timestamp() then return null; end if;
 select * into w from public.chat_external_wakes where id=p_wake_id and expires_at>clock_timestamp();
 if not found then return null; end if;
 select * into c from public.chat_conversations where id=w.conversation_id;
 select * into m from public.chat_messages where id=w.message_id and conversation_id=w.conversation_id;
 if c.id is null or m.id is null or m.unsent_at is not null or w.recipient_id not in(c.user_a,c.user_b)
  or m.sender_id not in(c.user_a,c.user_b) or m.sender_id=w.recipient_id
  or not exists(select 1 from public.chat_message_audience a where a.message_id=m.id and a.user_id=w.recipient_id)
  or public.findback_is_blocked_pair(c.user_a,c.user_b)
  or exists(select 1 from public.notification_preferences p where p.user_id=w.recipient_id and p.push_enabled=0)
  or (w.kind='CHAT_CONNECTED' and exists(select 1 from public.notification_preferences p
      where p.user_id=w.recipient_id and p.messages=0))
  or (w.kind='CHAT_REQUEST' and (c.state<>'REQUEST' or c.request_epoch is distinct from w.request_epoch
    or not m.first_approach or not exists(select 1 from public.chat_participant_views v
      where v.conversation_id=c.id and v.user_id=w.recipient_id and v.request_direction='INCOMING' and not v.hidden and not v.declined)))
  or (w.kind='CHAT_CONNECTED' and (c.state<>'CONNECTED' or c.receipt_connection_epoch is distinct from w.connection_epoch)) then return null; end if;
 select token into v_token from public.device_tokens where id=p_device_id and user_id=w.recipient_id;
 if v_token is null then return null; end if;
 return jsonb_build_object('wakeId',w.id,'recipientId',w.recipient_id,'conversationId',w.conversation_id,'kind',w.kind,'token',v_token);
end $$;

revoke all on function public.findback_get_notification_preferences_client() from public, anon;
grant execute on function public.findback_get_notification_preferences_client() to authenticated;
revoke all on function public.findback_set_notification_preferences_client(boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.findback_set_notification_preferences_client(boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;
revoke all on function public.findback_chat_external_wake_delivery(text,text,text) from public,anon,authenticated;
grant execute on function public.findback_chat_external_wake_delivery(text,text,text) to service_role;

commit;
