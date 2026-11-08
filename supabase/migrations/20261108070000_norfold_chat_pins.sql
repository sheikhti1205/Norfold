-- 2026-11-08: pinned messages. At most three per conversation, shared by both
-- participants and synchronized through the existing member projection.
--
-- Additive only: every existing member row starts with an empty pin list, and
-- no message, payload identity, mailbox envelope or receipt shape changes.
-- The list lives on both member rows so each participant's existing revision
-- trigger wakes their own devices; both rows are written in one transaction,
-- so the conversation has one shared list, not a per-device preference.

begin;

alter table public.chat_member_state
 add column if not exists pinned_message_ids text[] not null default '{}'::text[];

do $$ begin
 if not exists(select 1 from pg_constraint where conname='chat_member_state_pin_limit'
  and conrelid='public.chat_member_state'::regclass) then
  alter table public.chat_member_state add constraint chat_member_state_pin_limit
   check (cardinality(pinned_message_ids) <= 3) not valid;
 end if;
end $$;

-- One owner for pin/unpin. A pin must name a live message in the same
-- conversation; the shared limit is checked against the caller's row, which is
-- the same list both participants read. Re-pinning an already pinned message
-- is idempotent, so a retried tap cannot consume a second slot.
create or replace function public.findback_chat_set_pin(
 p_account_id text,p_device_id text,p_conversation_id text,p_message_id text,p_pinned boolean
) returns text[] language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_uid text:=auth.uid()::text; c public.chat_conversations%rowtype; v_pins text[];
begin
 if v_uid is null or p_account_id is distinct from v_uid
  or exists(select 1 from public.account_deletion_fences where user_id=v_uid) then
  raise exception 'Session unavailable' using errcode='42501'; end if;
 if p_pinned is null or p_message_id is null then
  raise exception 'Pin required' using errcode='22023'; end if;
 if not exists(select 1 from public.chat_devices where user_id=v_uid and device_id=p_device_id) then
  raise exception 'Device unavailable' using errcode='42501'; end if;
 -- Same lock order as sends, visibility changes and relationship mutations.
 select * into c from public.chat_conversations
  where id=p_conversation_id and v_uid in(user_a,user_b) for update;
 if not found or c.state<>'CONNECTED' then
  raise exception 'Conversation unavailable' using errcode='42501'; end if;
 if not exists(select 1 from public.chat_member_state
  where conversation_id=c.id and user_id=v_uid) then
  raise exception 'Conversation unavailable' using errcode='42501'; end if;
 select pinned_message_ids into v_pins from public.chat_member_state
  where conversation_id=c.id and user_id=v_uid;
 v_pins:=coalesce(v_pins,'{}'::text[]);
 if p_pinned then
  -- A pin references content the counterpart can still see. An unsent message
  -- is unavailable even if a stale device asks for it.
  if not exists(select 1 from public.chat_messages m
   where m.id=p_message_id and m.conversation_id=c.id and m.unsent_at is null) then
   raise exception 'Message unavailable' using errcode='42501'; end if;
  if p_message_id=any(v_pins) then return v_pins; end if;
  if cardinality(v_pins)>=3 then
   raise exception 'Pin limit reached' using errcode='22023'; end if;
  v_pins:=array_append(v_pins,p_message_id);
 else
  v_pins:=array_remove(v_pins,p_message_id);
 end if;
 update public.chat_member_state set pinned_message_ids=v_pins,revision=revision+1
  where conversation_id=c.id and user_id in(c.user_a,c.user_b);
 return v_pins;
end $$;
revoke all on function public.findback_chat_set_pin(text,text,text,text,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.findback_chat_set_pin(text,text,text,text,boolean) to authenticated;

-- An unsend removes the reference everywhere. The message row remains (for
-- reports and the counterpart's tombstone), but a pin can only point at a live
-- message. Revision bump wakes both participants' other devices.
create or replace function public.findback_chat_unpin_unsent_internal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.unsent_at is not null and old.unsent_at is distinct from new.unsent_at then
  update public.chat_member_state
   set pinned_message_ids=array_remove(pinned_message_ids,new.id),revision=revision+1
   where conversation_id=new.conversation_id and new.id=any(pinned_message_ids);
 end if;
 return new;
end $$;
revoke all on function public.findback_chat_unpin_unsent_internal()
 from public,anon,authenticated,service_role;

drop trigger if exists chat_messages_unpin_unsent on public.chat_messages;
create trigger chat_messages_unpin_unsent after update of unsent_at on public.chat_messages
 for each row execute function public.findback_chat_unpin_unsent_internal();

-- The projection is the only cross-device source for the strip. Both member
-- rows carry the same list, so either participant's view is complete.
create or replace function public.findback_chat_views(p_after text default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_uid text:=auth.uid()::text; result jsonb;
begin
 if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 select coalesce(jsonb_agg(page.value order by page.id),'[]'::jsonb) into result from (
  select c.id,jsonb_build_object('conversationId',c.id,
   'peerId',case when c.user_a=v_uid then c.user_b else c.user_a end,
   'mode',v.mode,'request',v.request_direction,'requestEpoch',v.request_epoch,
   'ownHidden',v.hidden,'ownDeclined',v.declined,'ownMuted',v.muted,'revision',v.revision,
   'pinnedMessageIds',v.pinned_message_ids,
   'epoch',public.findback_chat_relationship_epoch(c),
   'ownBlocked',exists(select 1 from public.user_blocks b where b.blocker_user_id=v_uid
     and b.blocked_user_id=case when c.user_a=v_uid then c.user_b else c.user_a end)) as value
  from public.chat_member_state v join public.chat_conversations c on c.id=v.conversation_id
  where v.user_id=v_uid and v_uid in(c.user_a,c.user_b) and (p_after is null or c.id>p_after)
  order by c.id limit 100
 ) page;
 return result;
end $$;

commit;

begin;
alter table public.chat_member_state validate constraint chat_member_state_pin_limit;
commit;
