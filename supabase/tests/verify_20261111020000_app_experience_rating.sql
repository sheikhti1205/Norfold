-- App rating ownership, validation, upsert and server aggregate contracts.
begin;
delete from public.app_experience_ratings;
insert into public.users(id, username, email, phone, email_verified, created_at, updated_at)
values
 ('00000000-0000-4000-9602-000000000001','rating_contract_one','rating_one@example.invalid','+8801962000001',1,'2026-11-11T00:00:00Z','2026-11-11T00:00:00Z'),
 ('00000000-0000-4000-9602-000000000002','rating_contract_two','rating_two@example.invalid','+8801962000002',1,'2026-11-11T00:00:00Z','2026-11-11T00:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-9602-000000000001',true);
select public.findback_rate_app_client(1);
select public.findback_rate_app_client(3);
do $$
begin
  if (select count(*) from public.app_experience_ratings) <> 1 then raise exception 'upsert did not retain one row'; end if;
  begin perform public.findback_rate_app_client(0); raise exception 'score 0 accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.findback_rate_app_client(6); raise exception 'score 6 accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-9602-000000000002',true);
do $$
declare result jsonb;
begin
  result := public.findback_rate_app_client(5);
  if result <> '{"my_score":5,"average":4.0,"count":2}'::jsonb then raise exception 'incorrect aggregate: %', result; end if;
  if (select count(*) from public.app_experience_ratings) <> 1 then raise exception 'foreign row visible'; end if;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$
begin
  begin perform public.findback_rate_app_client(3); raise exception 'unauthenticated rating accepted';
  exception when invalid_authorization_specification then null; end;
  begin perform public.findback_app_rating_context(); raise exception 'unauthenticated context accepted';
  exception when invalid_authorization_specification then null; end;
end $$;
reset role;
rollback;
