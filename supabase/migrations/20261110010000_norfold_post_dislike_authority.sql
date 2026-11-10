-- Fix forward: allow the exclusive Like/Dislike pair for post reactions.
-- The previous D1 guard allowed Like only for both posts and comments; this
-- replacement covers posts only. Comments remain Like-only through
-- findback_react_comment_client. The applied migration is not edited.
create or replace function public.findback_react_client(p_post_id text,p_type text)
returns table(post_id text,like_count bigint,dislike_count bigint,my_reaction text,reaction_counts jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid text:=auth.uid()::text;
  v_available boolean;
  v_locked boolean;
  v_previous text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='28000'; end if;
  if p_type is not null and p_type not in ('LIKE','DISLIKE') then
    raise exception 'Invalid reaction type' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('findback_reaction:'||v_uid||':'||p_post_id,0));
  loop
  begin
  perform 1 from public.item_posts p where p.id=p_post_id for share;
  v_locked:=found;
  select r.type into v_previous from public.reactions r
    where r.id=md5('reaction|'||p_post_id||'|'||v_uid);
  if p_type is not null and v_previous is distinct from p_type then
    if not pg_try_advisory_xact_lock(hashtextextended('findback_public_admission:'||v_uid,0)) then
      raise exception 'Retry public authority acquisition' using errcode='PFA01';
    end if;
  end if;
  v_available:=v_locked and public.findback_can_read_post_for(p_post_id,v_uid);
  if not v_available then
    if p_type is not null then raise exception 'Post not found' using errcode='P0002'; end if;
    return query select p_post_id,0::bigint,0::bigint,null::text,'{}'::jsonb;
    return;
  end if;
  if v_previous is distinct from p_type then
    if p_type is not null then perform public.findback_admit_public_action('POST_REACTION'); end if;
    delete from public.reactions r where r.post_id=p_post_id and r.user_id=v_uid;
    if p_type is not null then
      insert into public.reactions(id,post_id,user_id,type,created_at)
      values(md5('reaction|'||p_post_id||'|'||v_uid),p_post_id,v_uid,p_type,
        to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    end if;
  end if;
  return query select p_post_id,
    (select count(*) from public.reactions r where r.post_id=p_post_id and r.type='LIKE'),
    (select count(*) from public.reactions r where r.post_id=p_post_id and r.type='DISLIKE'),p_type,
    coalesce((select jsonb_object_agg(t.kind,t.n) from (
      select case when r.type='LIKE' then 'LOVE' else r.type end as kind,count(*) as n
      from public.reactions r where r.post_id=p_post_id group by 1)t),'{}'::jsonb);
  return;
  exception when sqlstate 'PFA01' then
    begin
      perform pg_advisory_xact_lock(hashtextextended('findback_public_admission:'||v_uid,0));
      raise exception 'Public author became available' using errcode='PFA02';
    exception when sqlstate 'PFA02' then null;
    end;
  end;
  end loop;
end $$;
revoke all on function public.findback_react_client(text,text) from public,anon;
grant execute on function public.findback_react_client(text,text) to authenticated;
