-- Run after migrations in a disposable database; no stored history is deleted.
begin;
do $$
declare
  trigger_definition text;
begin
  select pg_get_triggerdef(oid) into trigger_definition
  from pg_trigger
  where tgrelid = 'public.reactions'::regclass
    and tgname = 'trg_findback_notify_reaction' and not tgisinternal;
  if trigger_definition is null or trigger_definition not ilike '%DISLIKE%'
     or trigger_definition not ilike '%findback_notify_reaction%' then
    raise exception 'DISLIKE notification guard missing';
  end if;
end $$;
insert into public.users(id, username, email, phone, created_at, updated_at)
values
  ('00000000-0000-4000-9705-000000000001', 'dislike_owner_contract', 'dislike_owner@example.invalid', '+8801975000001', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z'),
  ('00000000-0000-4000-9705-000000000002', 'dislike_actor_contract', 'dislike_actor@example.invalid', '+8801975000002', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z');
insert into public.item_posts(id, user_id, type, title, description, category, event_date, created_at, updated_at)
values ('dislike_contract_post', '00000000-0000-4000-9705-000000000001', 'LOST', 'Contract', 'Contract', 'OTHER', '2026-11-12', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z');
insert into public.reactions(id, post_id, user_id, type, created_at)
values ('dislike_contract_reaction', 'dislike_contract_post', '00000000-0000-4000-9705-000000000002', 'DISLIKE', '2026-11-12T00:00:00Z');
do $$
begin
  if not exists (select 1 from public.reactions where id = 'dislike_contract_reaction' and type = 'DISLIKE')
     or exists (select 1 from public.notifications where post_id = 'dislike_contract_post' and type = 'DISLIKE') then
    raise exception 'DISLIKE reaction or notification behavior incorrect';
  end if;
end $$;
delete from public.reactions where id = 'dislike_contract_reaction';
insert into public.reactions(id, post_id, user_id, type, created_at)
values ('like_contract_reaction', 'dislike_contract_post', '00000000-0000-4000-9705-000000000002', 'LIKE', '2026-11-12T00:00:00Z');
do $$
begin
  if not exists (select 1 from public.notifications where post_id = 'dislike_contract_post' and type = 'LIKE') then
    raise exception 'LIKE notification missing';
  end if;
end $$;
rollback;
