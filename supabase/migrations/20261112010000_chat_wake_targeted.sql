-- Prepared only; not applied.
-- Message and state audience wakes include their available conversation and message IDs.
-- Older clients ignore the extra payload keys and still receive the invalidate hint.
-- Do not push until milestone acceptance and live verification, per the migration gate.
begin;

create or replace function public.findback_chat_wake_internal_targeted(
 p_user text,
 p_conversation text,
 p_message text
)
returns void language plpgsql volatile security definer set search_path=public,pg_temp as $$
begin
 if p_user is not null then
  perform realtime.send(
   jsonb_strip_nulls(jsonb_build_object('invalidate',true,'conversationId',p_conversation,'messageId',p_message)),
   'chat:invalidate','notification:'||p_user,true
  );
 end if;
end $$;
revoke all on function public.findback_chat_wake_internal_targeted(text,text,text) from public,anon,authenticated;

create or replace function public.findback_chat_wake_message_audience() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_conversation text; v_message text;
begin
 select m.conversation_id,m.id into v_conversation,v_message
  from public.chat_messages m where m.id=new.message_id;
 perform public.findback_chat_wake_internal_targeted(new.user_id,v_conversation,v_message);
 return null;
end $$;
revoke all on function public.findback_chat_wake_message_audience() from public,anon,authenticated;

create or replace function public.findback_chat_wake_state_audience() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_conversation text; v_message text;
begin
 select e.conversation_id,e.message_id into v_conversation,v_message
  from public.chat_state_events e where e.id=new.event_id;
 perform public.findback_chat_wake_internal_targeted(new.user_id,v_conversation,v_message);
 return null;
end $$;
revoke all on function public.findback_chat_wake_state_audience() from public,anon,authenticated;

commit;
