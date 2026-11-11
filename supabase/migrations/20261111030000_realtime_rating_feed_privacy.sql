-- Shared feed signals must not identify a post or expose its metadata.
-- Live inspection found this fifth broadcaster after the earlier source review.
create or replace function public.findback_broadcast_rating_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_post text;
  v_avg numeric;
  v_count bigint;
begin
  v_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;

  select round(avg(r.score), 2), count(*)
  into v_avg, v_count
  from public.ratings r
  where r.post_id = v_post;

  perform realtime.send(
    jsonb_build_object('postId', v_post, 'ratingAvg', v_avg, 'ratingCount', v_count),
    'rating:changed', 'post:' || v_post, true
  );
  perform realtime.send(
    jsonb_build_object('invalidate', true),
    'post:changed', 'feed', true
  );
  return null;
end;
$$;
revoke all on function public.findback_broadcast_rating_change() from public, anon, authenticated;
