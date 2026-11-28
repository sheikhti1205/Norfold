-- Run after migrations in a disposable database; no stored history is deleted.
-- 20261128125000_restore_dislike_activity.sql reversed the DISLIKE guard: a
-- dislike notifies the report owner exactly like a like, and a like -> dislike
-- switch replaces the unread row instead of adding a second one.
begin;
do $$
declare
  trigger_definition text;
begin
  select pg_get_triggerdef(oid) into trigger_definition
  from pg_trigger
  where tgrelid = 'public.reactions'::regclass
    and tgname = 'trg_findback_notify_reaction' and not tgisinternal;
  if trigger_definition is null or trigger_definition ilike '%DISLIKE%'
     or trigger_definition not ilike '%after insert on%'
     or trigger_definition not ilike '%reactions%'
     or trigger_definition not ilike '%findback_notify_reaction%' then
    raise exception 'reaction notification trigger still suppresses DISLIKE';
  end if;
end $$;
insert into public.users(id, username, email, phone, created_at, updated_at)
values
  ('00000000-0000-4000-9705-000000000001', 'dislike_owner_contract', 'dislike_owner@example.invalid', '+8801975000001', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z'),
  ('00000000-0000-4000-9705-000000000002', 'dislike_actor_contract', 'dislike_actor@example.invalid', '+8801975000002', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z');
insert into public.item_posts(id, user_id, type, title, description, category, event_date, created_at, updated_at)
values ('dislike_contract_post', '00000000-0000-4000-9705-000000000001', 'LOST', 'Contract', 'Contract', 'OTHER', '2026-11-12', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z');
insert into public.reactions(id, post_id, user_id, type, created_at)
values ('like_contract_reaction', 'dislike_contract_post', '00000000-0000-4000-9705-000000000002', 'LIKE', '2026-11-12T00:00:00Z');
delete from public.reactions where id = 'like_contract_reaction';
insert into public.reactions(id, post_id, user_id, type, created_at)
values ('dislike_contract_reaction', 'dislike_contract_post', '00000000-0000-4000-9705-000000000002', 'DISLIKE', '2026-11-12T00:01:00Z');
do $$
begin
  -- One current unread row: the DISLIKE that replaced the unread LIKE.
  if (select count(*) from public.notifications
      where post_id = 'dislike_contract_post'
        and user_id = '00000000-0000-4000-9705-000000000001'
        and actor_id = '00000000-0000-4000-9705-000000000002'
        and read = 0) <> 1
     or not exists (select 1 from public.notifications
                    where post_id = 'dislike_contract_post'
                      and user_id = '00000000-0000-4000-9705-000000000001'
                      and actor_id = '00000000-0000-4000-9705-000000000002'
                      and type = 'DISLIKE'
                      and read = 0) then
    raise exception 'DISLIKE notification missing or not a single replaced row';
  end if;
end $$;
rollback;
