-- Telegram phone verification projection and reversal paths.
begin;
insert into public.users(id, username, email, phone, email_verified, created_at, updated_at)
values
 ('00000000-0000-4000-9611-000000000001','telegram_projection_one','telegram_projection_one@example.invalid','+8801964110001',1,'2026-11-12T00:00:00Z','2026-11-12T00:00:00Z'),
 ('00000000-0000-4000-9611-000000000002','telegram_projection_two','telegram_projection_two@example.invalid','+8801964110002',1,'2026-11-12T00:00:00Z','2026-11-12T00:00:00Z');

insert into auth.users(id, email, raw_user_meta_data)
values ('00000000-0000-4000-9611-000000000001', 'telegram_projection_one@example.invalid',
        '{"username":"tg_projection_one","phone":"+8801964110001"}'::jsonb);

do $$
declare
  v_user constant text := '00000000-0000-4000-9611-000000000001';
  v_other constant text := '00000000-0000-4000-9611-000000000002';
  v_telegram constant bigint := 961100000001;
  v_token constant text := '96110000000000000000000000000001';
begin
  if (select telegram_phone_verified from public.users where id = v_user) is distinct from 0 then raise exception 'unlinked flag not zero'; end if;
  insert into public.telegram_links(telegram_id, user_id) values (v_telegram, v_user);
  if (select telegram_phone_verified from public.users where id = v_user) is distinct from 0 then raise exception 'new link flag not zero'; end if;

  perform public.findback_telegram_set_phone(v_telegram, '+123456789');
  if not exists (select 1 from public.telegram_links where user_id = v_user and phone_verified_at is not null)
     or (select telegram_phone_verified from public.users where id = v_user) is distinct from 1 then raise exception 'phone verification not projected'; end if;
  if not exists (select 1 from public.users where id = v_user and phone_verified = 0 and phone = '+8801964110001') then
    raise exception 'telegram verification changed auth-owned phone fields';
  end if;

  update auth.users set raw_user_meta_data = raw_user_meta_data || '{"telegram_projection_test":true}'::jsonb where id = v_user::uuid and phone_confirmed_at is null;
  if not found then raise exception 'unconfirmed auth user missing'; end if;
  if (select telegram_phone_verified from public.users where id = v_user) is distinct from 1 then raise exception 'auth update changed telegram verification'; end if;

  begin
    perform public.findback_telegram_set_phone(v_telegram, 'invalid');
    raise exception 'invalid phone accepted';
  exception when invalid_parameter_value then null; end;
  if (select telegram_phone_verified from public.users where id = v_user) is distinct from 1 then raise exception 'invalid phone changed flag'; end if;

  perform set_config('request.jwt.claim.sub', v_user, true);
  perform public.findback_telegram_unlink();
  if (select telegram_phone_verified from public.users where id = v_user) is distinct from 0 then raise exception 'app unlink did not clear flag'; end if;

  delete from public.phone_claim_events;
  delete from public.phone_claims;
  insert into public.telegram_links(telegram_id, user_id) values (v_telegram, v_user);
  perform public.findback_telegram_set_phone(v_telegram, '+123456789');
  perform public.findback_telegram_unlink_by_telegram(v_telegram);
  if (select telegram_phone_verified from public.users where id = v_user) is distinct from 0 then raise exception 'telegram unlink did not clear flag'; end if;

  delete from public.phone_claim_events;
  delete from public.phone_claims;
  insert into public.telegram_links(telegram_id, user_id) values (v_telegram, v_user);
  perform public.findback_telegram_set_phone(v_telegram, '+123456789');
  insert into public.telegram_login_tokens(token, user_id, expires_at) values (v_token, v_user, now() + interval '10 minutes');
  perform public.findback_telegram_consume(v_token, v_telegram, 'projection_test');
  if (select telegram_phone_verified from public.users where id = v_user) is distinct from 0
     or not exists (select 1 from public.telegram_links where user_id = v_user and phone_verified_at is null and phone is null) then raise exception 'relink did not clear verification'; end if;

  delete from public.phone_claim_events;
  delete from public.phone_claims;
  perform public.findback_telegram_set_phone(v_telegram, '+123456789');
  update public.telegram_links set user_id = v_other where telegram_id = v_telegram;
  if (select telegram_phone_verified from public.users where id = v_user) is distinct from 0
     or (select telegram_phone_verified from public.users where id = v_other) is distinct from 1 then raise exception 'link reassignment projection incorrect'; end if;
  update public.telegram_links set phone_verified_at = null where telegram_id = v_telegram;
  if (select telegram_phone_verified from public.users where id = v_other) is distinct from 0 then raise exception 'cleared timestamp did not clear flag'; end if;
  delete from public.users where id = v_other;
end $$;
rollback;
