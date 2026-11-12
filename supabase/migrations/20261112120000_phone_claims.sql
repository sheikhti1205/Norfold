-- LIVE-PENDING. Verify with supabase/tests/verify_20261112120000_phone_claims.sql.
create table if not exists public.phone_claims (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  user_id text not null unique references public.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now()
);

create table if not exists public.phone_claim_events (
  id bigserial primary key,
  phone text not null,
  user_id text,
  action text not null check (action in ('CLAIM', 'RELEASE', 'SUPERSEDE')),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'telegram_phone_verified'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.telegram_links'::regclass
      and tgname = 'telegram_links_phone_verified' and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'required migration missing: 20261112110000_telegram_phone_verified.sql';
  end if;
end $$;

create index if not exists phone_claim_events_phone_created_at on public.phone_claim_events(phone, created_at desc);
create index if not exists phone_claim_events_user_created_at on public.phone_claim_events(user_id, created_at desc);
alter table public.phone_claims enable row level security;
alter table public.phone_claim_events enable row level security;
revoke all on public.phone_claims from public, anon, authenticated;
revoke all on public.phone_claim_events from public, anon, authenticated;
grant select on public.phone_claims to authenticated;
drop policy if exists phone_claims_select_own on public.phone_claims;
create policy phone_claims_select_own on public.phone_claims
  for select to authenticated using (user_id = (select public.findback_uid()));

create or replace function public.findback_telegram_create_link_token() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user text := public.findback_uid();
  v_token text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if v_user is null or not exists (select 1 from public.users where id = v_user) then
    raise exception 'account required' using errcode = '28000';
  end if;
  if coalesce((select email_verified from public.users where id = v_user), 0) <> 1 then
    raise exception 'verify your email first' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  delete from public.telegram_login_tokens where user_id = v_user;
  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.telegram_login_tokens(token, user_id, expires_at)
    values (v_token, v_user, v_expires);
  return jsonb_build_object('token', v_token, 'deep_link', 'https://t.me/Norfold_auth_bot?start=' || v_token, 'expires_at', v_expires);
end $$;

create or replace function public.findback_telegram_consume(p_token text, p_telegram_id bigint, p_telegram_username text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user text;
begin
  if p_telegram_id is null then raise exception 'telegram id required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  select user_id into v_user from public.telegram_login_tokens
    where token = p_token and consumed_at is null and expires_at > now() for update;
  if not found then raise exception 'invalid or expired token' using errcode = '22023'; end if;
  with released as (
    delete from public.phone_claims where user_id = v_user or user_id in
      (select user_id from public.telegram_links where telegram_id = p_telegram_id)
    returning phone, user_id
  )
  insert into public.phone_claim_events(phone, user_id, action)
    select phone, user_id, 'RELEASE' from released;
  delete from public.telegram_links where telegram_id = p_telegram_id or user_id = v_user;
  insert into public.telegram_links(telegram_id, user_id, telegram_username) values (p_telegram_id, v_user, p_telegram_username);
  update public.telegram_login_tokens set consumed_at = now(), telegram_id = p_telegram_id where token = p_token;
  return jsonb_build_object('linked', true, 'user_id', v_user);
end $$;

create or replace function public.findback_telegram_set_phone(p_telegram_id bigint, p_phone text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user text;
  v_old_user text;
  v_old_phone text;
  v_pending int;
begin
  if p_phone is null or p_phone !~ '^\+[0-9]{7,15}$' or p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  select user_id into v_user from public.telegram_links where telegram_id = p_telegram_id;
  if not found then raise exception 'link not found' using errcode = '22023'; end if;
  if exists (select 1 from public.phone_claims where phone = p_phone and user_id = v_user) then
    update public.phone_claims set last_verified_at = now() where phone = p_phone and user_id = v_user;
    update public.telegram_links set phone = p_phone, phone_verified_at = now() where telegram_id = p_telegram_id;
    return jsonb_build_object('ok', true);
  end if;
  if (select count(*) from public.phone_claim_events where user_id = v_user and action = 'CLAIM' and created_at > now() - interval '7 days') >= 3 then
    raise exception 'phone claim account limit' using errcode = '54000';
  end if;
  select user_id into v_old_user from public.phone_claims where phone = p_phone and user_id <> v_user;
  v_pending := case when v_old_user is null then 1 else 2 end;
  if (select count(*) from public.phone_claim_events where phone = p_phone and action in ('CLAIM', 'SUPERSEDE') and created_at > now() - interval '30 days') + v_pending > 5 then
    raise exception 'phone claim number limit' using errcode = '54000';
  end if;
  if v_old_user is not null then
    insert into public.phone_claim_events(phone, user_id, action) values (p_phone, v_old_user, 'SUPERSEDE');
    delete from public.phone_claims where phone = p_phone;
    update public.telegram_links set phone = null, phone_verified_at = null where user_id = v_old_user;
  end if;
  select phone into v_old_phone from public.phone_claims where user_id = v_user and phone <> p_phone;
  if found then
    insert into public.phone_claim_events(phone, user_id, action) values (v_old_phone, v_user, 'RELEASE');
    delete from public.phone_claims where user_id = v_user;
  end if;
  insert into public.phone_claims(phone, user_id) values (p_phone, v_user)
    on conflict (phone) do update set last_verified_at = now();
  insert into public.phone_claim_events(phone, user_id, action) values (p_phone, v_user, 'CLAIM');
  update public.telegram_links set phone = p_phone, phone_verified_at = now() where telegram_id = p_telegram_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.findback_telegram_unlink() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user text := public.findback_uid();
begin
  if v_user is null then raise exception 'account required' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  with released as (delete from public.phone_claims where user_id = v_user returning phone, user_id)
  insert into public.phone_claim_events(phone, user_id, action) select phone, user_id, 'RELEASE' from released;
  delete from public.telegram_links where user_id = v_user;
  return jsonb_build_object('unlinked', true);
end $$;

create or replace function public.findback_telegram_unlink_by_telegram(p_telegram_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  with released as (
    delete from public.phone_claims where user_id = (select user_id from public.telegram_links where telegram_id = p_telegram_id)
    returning phone, user_id
  )
  insert into public.phone_claim_events(phone, user_id, action) select phone, user_id, 'RELEASE' from released;
  delete from public.telegram_links where telegram_id = p_telegram_id;
  return jsonb_build_object('unlinked', true);
end $$;

revoke all on function public.findback_telegram_create_link_token() from public, anon, authenticated;
revoke all on function public.findback_telegram_consume(text, bigint, text) from public, anon, authenticated;
revoke all on function public.findback_telegram_set_phone(bigint, text) from public, anon, authenticated;
revoke all on function public.findback_telegram_unlink() from public, anon, authenticated;
revoke all on function public.findback_telegram_unlink_by_telegram(bigint) from public, anon, authenticated;
grant execute on function public.findback_telegram_create_link_token() to authenticated;
grant execute on function public.findback_telegram_unlink() to authenticated;
grant execute on function public.findback_telegram_consume(text, bigint, text) to service_role;
grant execute on function public.findback_telegram_set_phone(bigint, text) to service_role;
grant execute on function public.findback_telegram_unlink_by_telegram(bigint) to service_role;

-- Serialize backfill with link and claim mutations, including on a rerun.
select pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
insert into public.phone_claims(phone, user_id, claimed_at, last_verified_at)
select distinct on (l.phone) l.phone, l.user_id, l.phone_verified_at, l.phone_verified_at
from public.telegram_links l
where l.phone_verified_at is not null
  and l.phone ~ '^\+[1-9][0-9]{6,14}$'
  and not exists (select 1 from public.phone_claims c where c.user_id = l.user_id)
order by l.phone, l.phone_verified_at desc nulls last, l.user_id
on conflict (phone) do nothing;

update public.telegram_links l set phone = null, phone_verified_at = null
where l.phone is not null
  and not exists (select 1 from public.phone_claims c where c.phone = l.phone and c.user_id = l.user_id);
