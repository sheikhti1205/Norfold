-- LIVE-PENDING. Verify with supabase/tests/verify_20261111040000_telegram_auth.sql.
create table public.telegram_login_tokens (
  token text primary key check (token ~ '^[0-9a-f]{32}$'),
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  telegram_id bigint
);

create unique index telegram_login_tokens_one_unconsumed
  on public.telegram_login_tokens(user_id) where consumed_at is null;

create table public.telegram_links (
  telegram_id bigint primary key,
  user_id text not null unique references public.users(id) on delete cascade,
  telegram_username text,
  phone text,
  phone_verified_at timestamptz,
  linked_at timestamptz not null default now()
);

alter table public.telegram_login_tokens enable row level security;
alter table public.telegram_links enable row level security;
revoke all on public.telegram_login_tokens from public, anon, authenticated;
revoke all on public.telegram_links from public, anon, authenticated;
grant select on public.telegram_login_tokens to authenticated;
grant select on public.telegram_links to authenticated;
create policy telegram_login_tokens_select_own on public.telegram_login_tokens
  for select to authenticated using (user_id = (select public.findback_uid()));
create policy telegram_links_select_own on public.telegram_links
  for select to authenticated using (user_id = (select public.findback_uid()));

create function public.findback_telegram_create_link_token() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user text := public.findback_uid();
  v_token text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if v_user is null or not exists (select 1 from public.users where id = v_user) then
    raise exception 'account required' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  delete from public.telegram_login_tokens where user_id = v_user;
  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.telegram_login_tokens(token, user_id, expires_at)
    values (v_token, v_user, v_expires);
  return jsonb_build_object('token', v_token, 'deep_link', 'https://t.me/Norfold_auth_bot?start=' || v_token, 'expires_at', v_expires);
end $$;

create function public.findback_telegram_link_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user text := public.findback_uid();
  v_token public.telegram_login_tokens%rowtype;
  v_phone text;
begin
  if v_user is null then raise exception 'account required' using errcode = '28000'; end if;
  select * into v_token from public.telegram_login_tokens where token = p_token and user_id = v_user;
  if not found then return jsonb_build_object('state', 'expired', 'phone', null); end if;
  if v_token.consumed_at is not null then
    select phone into v_phone from public.telegram_links where user_id = v_user and telegram_id = v_token.telegram_id;
    if found then return jsonb_build_object('state', 'linked', 'phone', v_phone); end if;
    return jsonb_build_object('state', 'expired', 'phone', null);
  end if;
  if v_token.expires_at <= now() then return jsonb_build_object('state', 'expired', 'phone', null); end if;
  return jsonb_build_object('state', 'pending', 'phone', null);
end $$;

create function public.findback_telegram_account_state() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user text := public.findback_uid();
  v_phone text;
  v_username text;
begin
  if v_user is null then raise exception 'account required' using errcode = '28000'; end if;
  select phone, telegram_username into v_phone, v_username
    from public.telegram_links where user_id = v_user;
  if not found then
    return jsonb_build_object('linked', false, 'phone', null, 'telegram_username', null);
  end if;
  return jsonb_build_object('linked', true, 'phone', v_phone, 'telegram_username', v_username);
end $$;

create function public.findback_telegram_consume(p_token text, p_telegram_id bigint, p_telegram_username text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user text;
begin
  if p_telegram_id is null then raise exception 'telegram id required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  select user_id into v_user from public.telegram_login_tokens
    where token = p_token and consumed_at is null and expires_at > now() for update;
  if not found then raise exception 'invalid or expired token' using errcode = '22023'; end if;
  delete from public.telegram_links where telegram_id = p_telegram_id or user_id = v_user;
  insert into public.telegram_links(telegram_id, user_id, telegram_username) values (p_telegram_id, v_user, p_telegram_username);
  update public.telegram_login_tokens set consumed_at = now(), telegram_id = p_telegram_id where token = p_token;
  return jsonb_build_object('linked', true, 'user_id', v_user);
end $$;

create function public.findback_telegram_set_phone(p_telegram_id bigint, p_phone text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_phone is null or p_phone !~ '^\+[0-9]{7,15}$' then raise exception 'invalid phone' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  update public.telegram_links set phone = p_phone, phone_verified_at = now() where telegram_id = p_telegram_id;
  if not found then raise exception 'link not found' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.findback_telegram_unlink() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user text := public.findback_uid();
begin
  if v_user is null then raise exception 'account required' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  delete from public.telegram_links where user_id = v_user;
  return jsonb_build_object('unlinked', true);
end $$;

create function public.findback_telegram_unlink_by_telegram(p_telegram_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  delete from public.telegram_links where telegram_id = p_telegram_id;
  return jsonb_build_object('unlinked', true);
end $$;

revoke all on function public.findback_telegram_create_link_token() from public, anon, authenticated;
revoke all on function public.findback_telegram_link_state(text) from public, anon, authenticated;
revoke all on function public.findback_telegram_account_state() from public, anon, authenticated;
revoke all on function public.findback_telegram_consume(text, bigint, text) from public, anon, authenticated;
revoke all on function public.findback_telegram_set_phone(bigint, text) from public, anon, authenticated;
revoke all on function public.findback_telegram_unlink() from public, anon, authenticated;
revoke all on function public.findback_telegram_unlink_by_telegram(bigint) from public, anon, authenticated;
grant execute on function public.findback_telegram_create_link_token() to authenticated;
grant execute on function public.findback_telegram_link_state(text) to authenticated;
grant execute on function public.findback_telegram_account_state() to authenticated;
grant execute on function public.findback_telegram_unlink() to authenticated;
grant execute on function public.findback_telegram_consume(text, bigint, text) to service_role;
grant execute on function public.findback_telegram_set_phone(bigint, text) to service_role;
grant execute on function public.findback_telegram_unlink_by_telegram(bigint) to service_role;
