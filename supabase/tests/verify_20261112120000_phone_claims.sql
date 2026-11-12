-- Telegram phone claim lifecycle, limits, backfill, ownership and ACLs.
begin;
insert into public.users(id, username, email, phone, email_verified, created_at, updated_at)
values
 ('00000000-0000-4000-9704-000000000001','claim_contract_one','claim_one@example.invalid','+8801974000001',0,'2026-11-11T00:00:00Z','2026-11-11T00:00:00Z'),
 ('00000000-0000-4000-9704-000000000002','claim_contract_two','claim_two@example.invalid','+8801974000002',1,'2026-11-11T00:00:00Z','2026-11-11T00:00:00Z'),
 ('00000000-0000-4000-9704-000000000003','claim_contract_three','claim_three@example.invalid','+8801974000003',1,'2026-11-11T00:00:00Z','2026-11-11T00:00:00Z'),
 ('00000000-0000-4000-9704-000000000004','claim_contract_four','claim_four@example.invalid','+8801974000004',1,'2026-11-11T00:00:00Z','2026-11-11T00:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-9704-000000000001',true);
do $$
begin
  begin
    perform public.findback_telegram_create_link_token();
    raise exception 'unverified email accepted';
  exception when sqlstate '28000' then null; end;
end $$;
reset role;
update public.users set email_verified = 1 where id = '00000000-0000-4000-9704-000000000001';
set local role authenticated;
do $$
declare result jsonb;
begin
  result := public.findback_telegram_create_link_token();
  if result->>'token' !~ '^[0-9a-f]{32}$' then raise exception 'verified email token failed'; end if;
  perform set_config('test.claim_token', result->>'token', true);
  begin
    insert into public.phone_claims(phone,user_id) values ('+123456789','00000000-0000-4000-9704-000000000001');
    raise exception 'client claim write allowed';
  exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
select public.findback_telegram_consume(current_setting('test.claim_token'), 970401);
do $$
begin
  if public.findback_telegram_set_phone(970401, '+123456789') <> '{"ok":true}'::jsonb then raise exception 'first claim failed'; end if;
  for i in 1..4 loop
    if public.findback_telegram_set_phone(970401, '+123456789') <> '{"ok":true}'::jsonb then raise exception 'reverification failed'; end if;
  end loop;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.phone_claims where phone = '+123456789' and user_id = '00000000-0000-4000-9704-000000000001') <> 1
     or (select count(*) from public.phone_claim_events where phone = '+123456789' and action = 'CLAIM') <> 1 then raise exception 'reverification changed claim count'; end if;
end $$;
set local role service_role;
select public.findback_telegram_set_phone(970401, '+123456780');
select public.findback_telegram_set_phone(970401, '+123456781');
do $$
begin
  begin
    perform public.findback_telegram_set_phone(970401, '+123456782');
    raise exception 'fourth distinct claim accepted';
  exception when sqlstate '54000' then null; end;
  if public.findback_telegram_set_phone(970401, '+123456781') <> '{"ok":true}'::jsonb then raise exception 'reverification blocked by account cap'; end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.phone_claims where user_id = '00000000-0000-4000-9704-000000000001') <> 1
     or not exists (select 1 from public.phone_claims where phone = '+123456781')
     or not exists (select 1 from public.phone_claim_events where phone = '+123456789' and action = 'RELEASE') then raise exception 'replacement claim incorrect'; end if;
end $$;
insert into public.telegram_links(telegram_id,user_id) values (970402,'00000000-0000-4000-9704-000000000002');
set local role service_role;
select public.findback_telegram_set_phone(970402, '+123456781');
reset role;
do $$
begin
  if not exists (select 1 from public.phone_claims where phone = '+123456781' and user_id = '00000000-0000-4000-9704-000000000002')
     or exists (select 1 from public.telegram_links where telegram_id = 970401 and (phone is not null or phone_verified_at is not null))
     or not exists (select 1 from public.phone_claim_events where phone = '+123456781' and user_id = '00000000-0000-4000-9704-000000000001' and action = 'SUPERSEDE') then raise exception 'supersession failed'; end if;
end $$;
-- Three counted events already exist for this phone; add one to reach four.
insert into public.phone_claim_events(phone,user_id,action) values ('+123456781', null, 'CLAIM');
insert into public.telegram_links(telegram_id,user_id) values (970403,'00000000-0000-4000-9704-000000000003');
set local role service_role;
do $$
begin
  begin
    perform public.findback_telegram_set_phone(970403, '+123456781');
    raise exception 'supersede exceeded number limit';
  exception when sqlstate '54000' then
    if sqlerrm <> 'phone claim number limit' then raise; end if;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.phone_claim_events where phone = '+123456781' and action in ('CLAIM', 'SUPERSEDE')) <> 4
     or not exists (select 1 from public.phone_claims where phone = '+123456781' and user_id = '00000000-0000-4000-9704-000000000002')
     or exists (select 1 from public.phone_claims where user_id = '00000000-0000-4000-9704-000000000003') then
    raise exception 'rejected supersession changed claim or events';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-9704-000000000001',true);
do $$
begin
  begin
    perform count(*) from public.phone_claim_events;
    raise exception 'authenticated event read allowed';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.phone_claims) then raise exception 'foreign claim visible'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-9704-000000000002',true);
do $$
begin
  if (select count(*) from public.phone_claims) <> 1 then raise exception 'own claim invisible'; end if;
  perform public.findback_telegram_unlink();
  if exists (select 1 from public.phone_claims) then raise exception 'unlink retained claim'; end if;
end $$;
reset role;
insert into public.telegram_links(telegram_id,user_id) values (970402,'00000000-0000-4000-9704-000000000002');
-- Four counted events and multiple releases must still allow one claim.
insert into public.phone_claim_events(phone,user_id,action)
select '+123456783', null, 'CLAIM' from generate_series(1,4);
insert into public.phone_claim_events(phone,user_id,action)
select '+123456783', null, 'RELEASE' from generate_series(1,5);
set local role service_role;
select public.findback_telegram_set_phone(970402, '+123456783');
select public.findback_telegram_set_phone(970402, '+123456783');
select public.findback_telegram_unlink_by_telegram(970402);
reset role;
do $$
begin
  if exists (select 1 from public.phone_claims where phone = '+123456783') or not exists (select 1 from public.phone_claim_events where phone = '+123456783' and user_id = '00000000-0000-4000-9704-000000000002' and action = 'RELEASE') then raise exception 'bot unlink retained claim'; end if;
end $$;
set local role service_role;
select public.findback_telegram_set_phone(970403, '+123456784');
reset role;
insert into public.telegram_login_tokens(token,user_id,expires_at) values ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','00000000-0000-4000-9704-000000000003',now() + interval '10 minutes');
set local role service_role;
select public.findback_telegram_consume('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 970404);
reset role;
do $$
begin
  if exists (select 1 from public.phone_claims where phone = '+123456784') or not exists (select 1 from public.phone_claim_events where phone = '+123456784' and action = 'RELEASE') then raise exception 'relink retained claim'; end if;
end $$;
set local role service_role;
select public.findback_telegram_set_phone(970404, '+123456785');
reset role;
delete from public.users where id = '00000000-0000-4000-9704-000000000003';
do $$
begin
  if exists (select 1 from public.phone_claims where phone = '+123456785') then raise exception 'deleted user retained claim'; end if;
  if not exists (select 1 from public.phone_claim_events where phone = '+123456785' and user_id = '00000000-0000-4000-9704-000000000003' and action = 'CLAIM') then raise exception 'deletion removed audit'; end if;
end $$;

insert into public.telegram_links(telegram_id,user_id,phone,phone_verified_at)
values (970405,'00000000-0000-4000-9704-000000000004','+123456786',now());
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
do $$
begin
  if (select count(*) from public.phone_claims where phone = '+123456786' and user_id = '00000000-0000-4000-9704-000000000004') <> 1 then raise exception 'backfill failed'; end if;
end $$;
rollback;
