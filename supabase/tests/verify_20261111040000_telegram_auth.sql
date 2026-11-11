-- Telegram linking ownership, ACLs, token lifecycle and phone validation.
begin;
insert into public.users(id, username, email, phone, email_verified, created_at, updated_at)
values
 ('00000000-0000-4000-9604-000000000001','telegram_contract_one','telegram_one@example.invalid','+8801964000001',1,'2026-11-11T00:00:00Z','2026-11-11T00:00:00Z'),
 ('00000000-0000-4000-9604-000000000002','telegram_contract_two','telegram_two@example.invalid','+8801964000002',1,'2026-11-11T00:00:00Z','2026-11-11T00:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-9604-000000000001',true);
do $$
declare first_token text; result jsonb;
begin
  if public.findback_telegram_account_state() <> '{"linked":false,"phone":null,"telegram_username":null}'::jsonb then raise exception 'unlinked account state incorrect'; end if;
  result := public.findback_telegram_create_link_token();
  first_token := result->>'token';
  if first_token !~ '^[0-9a-f]{32}$' or result->>'deep_link' <> 'https://t.me/Norfold_auth_bot?start=' || first_token then
    raise exception 'invalid token response: %', result;
  end if;
  result := public.findback_telegram_create_link_token();
  if result->>'token' = first_token or public.findback_telegram_link_state(first_token)->>'state' <> 'expired' then
    raise exception 'previous token not invalidated';
  end if;
  if public.findback_telegram_link_state(result->>'token')->>'state' <> 'pending' then raise exception 'new token not pending'; end if;
  perform set_config('test.telegram_token', result->>'token', true);
  begin perform public.findback_telegram_consume(result->>'token', 12345); raise exception 'authenticated consume allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.findback_telegram_set_phone(12345, '+123456789'); raise exception 'authenticated set phone allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.findback_telegram_unlink_by_telegram(12345); raise exception 'authenticated bot unlink allowed';
  exception when insufficient_privilege then null; end;
end $$;

set local role service_role;
do $$
declare result jsonb; t text := current_setting('test.telegram_token');
begin
  result := public.findback_telegram_consume(t, 12345, 'contract_username');
  if result <> '{"linked":true,"user_id":"00000000-0000-4000-9604-000000000001"}'::jsonb then raise exception 'consume failed: %', result; end if;
  begin perform public.findback_telegram_consume(t, 12345); raise exception 'double consume allowed';
  exception when invalid_parameter_value then null; end;
  begin perform public.findback_telegram_set_phone(12345, '123'); raise exception 'invalid phone accepted';
  exception when invalid_parameter_value then null; end;
  if public.findback_telegram_set_phone(12345, '+123456789') <> '{"ok":true}'::jsonb then raise exception 'valid phone rejected'; end if;
end $$;
reset role;
insert into public.telegram_login_tokens(token,user_id,expires_at)
values ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','00000000-0000-4000-9604-000000000002',now() - interval '1 minute');
set local role service_role;
do $$
begin
  begin perform public.findback_telegram_consume('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 12346); raise exception 'expired token accepted';
  exception when invalid_parameter_value then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-9604-000000000002',true);
do $$
begin
  if public.findback_telegram_link_state(current_setting('test.telegram_token')) <> public.findback_telegram_link_state('missing') then raise exception 'foreign token visible'; end if;
  if exists (select 1 from public.telegram_links) then raise exception 'foreign link visible'; end if;
  if public.findback_telegram_account_state() <> '{"linked":false,"phone":null,"telegram_username":null}'::jsonb then raise exception 'foreign account state visible'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-9604-000000000001',true);
do $$
begin
  if public.findback_telegram_link_state(current_setting('test.telegram_token')) <> '{"state":"linked","phone":"+123456789"}'::jsonb then raise exception 'linked state incorrect'; end if;
  if public.findback_telegram_account_state() <> '{"linked":true,"phone":"+123456789","telegram_username":"contract_username"}'::jsonb then raise exception 'linked account state incorrect'; end if;
  if public.findback_telegram_account_state() ? 'telegram_id' then raise exception 'telegram id exposed'; end if;
  perform public.findback_telegram_unlink();
  if exists (select 1 from public.telegram_links) then raise exception 'unlink failed'; end if;
  if public.findback_telegram_link_state(current_setting('test.telegram_token'))->>'state' not in ('expired', 'pending') then raise exception 'unlinked token still linked'; end if;
end $$;

set local role anon;
do $$
begin
  begin perform public.findback_telegram_create_link_token(); raise exception 'anon create allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.findback_telegram_link_state('missing'); raise exception 'anon state allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.findback_telegram_account_state(); raise exception 'anon account state allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.findback_telegram_unlink(); raise exception 'anon unlink allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
