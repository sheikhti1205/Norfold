-- Taking a number that another account already
-- verified must be deliberate.
--
-- The first version of the claim RPC moved a taken number on a single contact
-- share and silently cleared it from the old account. That is a destructive
-- move triggered by a mis-tap. The number now moves only after a second share
-- inside ten minutes:
--
--   1. first share  -> ATTEMPT recorded, nothing changes, the bot explains;
--   2. second share within ten minutes -> SUPERSEDE + CLAIM, the old account is
--      told (its telegram id is returned for the webhook to message), and the
--      new owner is told the number moved.
--
-- The existing limits stay: 3 CLAIMs per account per 7 days, and 5 CLAIMs +
-- SUPERSEDEs per number per 30 days (a move counts as two). ATTEMPT rows never
-- consume either quota, so an honest first share cannot lock an account out.
begin;

alter table public.phone_claim_events
  drop constraint if exists phone_claim_events_action_check;
alter table public.phone_claim_events
  add constraint phone_claim_events_action_check
  check (action in ('CLAIM', 'RELEASE', 'SUPERSEDE', 'ATTEMPT'));

create index if not exists phone_claim_events_attempt_lookup
  on public.phone_claim_events(user_id, phone, created_at desc)
  where action = 'ATTEMPT';

create or replace function public.findback_telegram_set_phone(
  p_telegram_id bigint,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user text;
  v_old_user text;
  v_old_telegram_id bigint;
  v_old_phone text;
  v_pending int;
  v_confirmed boolean;
begin
  if p_phone is null or p_phone !~ '^\+[0-9]{7,15}$' or p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('findback-telegram-links', 0));
  select user_id into v_user from public.telegram_links where telegram_id = p_telegram_id;
  if not found then raise exception 'link not found' using errcode = '22023'; end if;

  -- Re-sharing the number this account already owns is a no-op refresh.
  if exists (select 1 from public.phone_claims where phone = p_phone and user_id = v_user) then
    update public.phone_claims set last_verified_at = now() where phone = p_phone and user_id = v_user;
    update public.telegram_links set phone = p_phone, phone_verified_at = now() where telegram_id = p_telegram_id;
    return jsonb_build_object('ok', true);
  end if;

  if (select count(*) from public.phone_claim_events
       where user_id = v_user and action = 'CLAIM'
         and created_at > now() - interval '7 days') >= 3 then
    raise exception 'phone claim account limit' using errcode = '54000';
  end if;

  select user_id into v_old_user from public.phone_claims where phone = p_phone and user_id <> v_user;
  v_pending := case when v_old_user is null then 1 else 2 end;

  -- Refuse before asking for confirmation when the number's quota could not
  -- absorb the move anyway.
  if (select count(*) from public.phone_claim_events
       where phone = p_phone and action in ('CLAIM', 'SUPERSEDE')
         and created_at > now() - interval '30 days') + v_pending > 5 then
    raise exception 'phone claim number limit' using errcode = '54000';
  end if;

  if v_old_user is not null then
    select exists (
      select 1 from public.phone_claim_events
       where user_id = v_user and phone = p_phone and action = 'ATTEMPT'
         and created_at > now() - interval '10 minutes'
    ) into v_confirmed;
    if not v_confirmed then
      insert into public.phone_claim_events(phone, user_id, action)
        values (p_phone, v_user, 'ATTEMPT');
      return jsonb_build_object('ok', false, 'conflict', 'confirm');
    end if;
  end if;

  if v_old_user is not null then
    insert into public.phone_claim_events(phone, user_id, action)
      values (p_phone, v_old_user, 'SUPERSEDE');
    delete from public.phone_claims where phone = p_phone;
    update public.telegram_links set phone = null, phone_verified_at = null where user_id = v_old_user;
    select telegram_id into v_old_telegram_id
      from public.telegram_links
     where user_id = v_old_user and telegram_id <> p_telegram_id
     limit 1;
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

  if v_old_user is not null then
    return jsonb_build_object('ok', true, 'moved', true, 'notify_telegram_id', v_old_telegram_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.findback_telegram_set_phone(bigint, text) from public, anon, authenticated;
grant execute on function public.findback_telegram_set_phone(bigint, text) to service_role;

commit;
