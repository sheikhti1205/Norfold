-- LIVE-PENDING. Not applied to production. Verify with supabase/tests/verify_20261112110000_telegram_phone_verified.sql.

alter table public.users add column if not exists telegram_phone_verified integer not null default 0;
alter table public.users drop constraint if exists users_telegram_phone_verified_check;
alter table public.users add constraint users_telegram_phone_verified_check check (telegram_phone_verified in (0, 1));

create or replace function public.findback_sync_telegram_phone_verified()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_user text;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
  else
    v_user := coalesce(new.user_id, old.user_id);
  end if;

  update public.users u
     set telegram_phone_verified = case when exists (
       select 1 from public.telegram_links l
        where l.user_id = u.id and l.phone_verified_at is not null
     ) then 1 else 0 end
   where u.id = v_user;

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    update public.users u
       set telegram_phone_verified = case when exists (
         select 1 from public.telegram_links l
          where l.user_id = u.id and l.phone_verified_at is not null
       ) then 1 else 0 end
     where u.id = old.user_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.findback_sync_telegram_phone_verified() from public, anon, authenticated;

drop trigger if exists telegram_links_phone_verified on public.telegram_links;
create trigger telegram_links_phone_verified
  after insert or update or delete on public.telegram_links
  for each row execute function public.findback_sync_telegram_phone_verified();

update public.users u
   set telegram_phone_verified = case when exists (
     select 1 from public.telegram_links l
      where l.user_id = u.id and l.phone_verified_at is not null
   ) then 1 else 0 end
 where u.telegram_phone_verified is distinct from case when exists (
   select 1 from public.telegram_links l
    where l.user_id = u.id and l.phone_verified_at is not null
 ) then 1 else 0 end;
