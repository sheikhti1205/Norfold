-- One private app-experience rating per account; only aggregates leave the server.
create table public.app_experience_ratings (
  user_id text primary key references public.users(id) on delete cascade,
  score integer not null check (score between 1 and 5),
  created_at text not null default to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at text not null default to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

alter table public.app_experience_ratings enable row level security;
revoke all on public.app_experience_ratings from public, anon, authenticated;
grant select, insert, update on public.app_experience_ratings to authenticated;
create policy app_rating_select_own on public.app_experience_ratings for select to authenticated
  using (user_id = public.findback_uid());
create policy app_rating_insert_own on public.app_experience_ratings for insert to authenticated
  with check (user_id = public.findback_uid());
create policy app_rating_update_own on public.app_experience_ratings for update to authenticated
  using (user_id = public.findback_uid()) with check (user_id = public.findback_uid());

create function public.findback_app_rating_context()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid text := auth.uid()::text; v_result jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select jsonb_build_object(
    'my_score', max(score) filter (where user_id = v_uid),
    'average', round(avg(score), 1),
    'count', count(*)
  ) into v_result from public.app_experience_ratings;
  return v_result;
end $$;
revoke all on function public.findback_app_rating_context() from public, anon;
grant execute on function public.findback_app_rating_context() to authenticated;

create function public.findback_rate_app_client(p_score integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid text := auth.uid()::text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'Invalid score' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = v_uid) then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  insert into public.app_experience_ratings(user_id, score) values (v_uid, p_score)
  on conflict (user_id) do update set score = excluded.score,
    updated_at = to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  return public.findback_app_rating_context();
end $$;
revoke all on function public.findback_rate_app_client(integer) from public, anon;
grant execute on function public.findback_rate_app_client(integer) to authenticated;
