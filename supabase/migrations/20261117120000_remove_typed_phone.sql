-- A typed mobile number has no place in Norfold.
--
-- Only a Telegram contact share proves ownership of a number. The sign-up form,
-- the social profile-completion form and both RPCs behind them required a typed
-- number and stored it as `users.phone` with `phone_verified = 0`: a value the
-- account could never verify, that the UI then showed as if it were an account
-- fact. This migration removes every write path. The column stays NOT NULL for
-- compatibility; every new row stores the empty string.
--
-- Existing rows are not rewritten: an account that typed a number keeps its
-- historical value, but no surface reads `users.phone` for verification any
-- more. `telegram_phone_verified` (added by 20261112110000) is the one signal.
begin;

-- ---------------------------------------------------------------------------
-- 1. The verified-phone flag becomes readable by its owner.
--    `fetchMe` selects it in place of `phone_verified`; without this column
--    privilege the own-profile read would fail with 42501.
-- ---------------------------------------------------------------------------
grant select (telegram_phone_verified) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Auth provisioning: username is the only profile prerequisite.
--
-- A Google sign-up has no username metadata, so it still lands in the
-- completion flow; an email sign-up passes the username it chose. No phone is
-- read, validated or stored.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
  v_now      text;
begin
  v_username := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');

  -- No username: the client completes the profile through the RPC below.
  if v_username is null then
    return new;
  end if;

  if v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'invalid username for auth user %', new.id using errcode = '22023';
  end if;

  v_now := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  insert into public.users (
    id, username, email, phone, password_hash,
    email_verified, phone_verified, avatar_url, created_at, updated_at
  ) values (
    new.id::text,
    v_username,
    coalesce(new.email, ''),
    '',
    null,
    case when new.email_confirmed_at is not null then 1 else 0 end,
    0,
    null,
    v_now,
    v_now
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Auth updates stop copying a typed or provider phone into `users.phone`.
--    Email confirmation remains the only field this trigger owns.
-- ---------------------------------------------------------------------------
create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email_verified integer := case when new.email_confirmed_at is not null then 1 else 0 end;
begin
  update public.users
     set email_verified = v_email_verified,
         updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   where id = new.id::text
     and email_verified is distinct from v_email_verified;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Social completion without a phone parameter.
--
-- The old four-argument function is dropped rather than overloaded: a client
-- that still sends p_phone must fail loudly instead of matching the old
-- signature and quietly storing the number again.
-- ---------------------------------------------------------------------------
drop function if exists public.complete_social_profile(text, text, text, text);

create or replace function public.complete_social_profile(
  p_username text,
  p_display_name text,
  p_avatar_url text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      text := public.findback_uid();
  v_username text := nullif(btrim(coalesce(p_username, '')), '');
  v_display  text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_avatar   text := nullif(btrim(coalesce(p_avatar_url, '')), '');
  v_email    text;
  v_verified integer;
  v_now      text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_username is null or v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'invalid username' using errcode = '22023';
  end if;
  if v_display is null or char_length(v_display) > 80 then
    raise exception 'invalid display name' using errcode = '22023';
  end if;
  if v_avatar is not null
     and (char_length(v_avatar) > 2048 or v_avatar !~ '^https://') then
    v_avatar := null;
  end if;

  select a.email,
         case when a.email_confirmed_at is not null then 1 else 0 end
    into v_email, v_verified
    from auth.users a
   where a.id::text = v_uid;
  if v_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_now := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  insert into public.users (
    id, username, email, phone, password_hash, display_name,
    email_verified, phone_verified, avatar_url, created_at, updated_at
  ) values (
    v_uid, v_username, v_email, '', null, v_display,
    v_verified, 0, v_avatar, v_now, v_now
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.complete_social_profile(text, text, text) from public, anon;
grant execute on function public.complete_social_profile(text, text, text) to authenticated;

commit;
