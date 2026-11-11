-- Shared feed signals must not identify a post or expose its metadata.
create or replace function public.findback_broadcast_post_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  perform realtime.send(jsonb_build_object('invalidate', true), 'post:changed', 'feed', true);
  perform realtime.send(
    jsonb_build_object('postId', v_id, 'op', tg_op, 'change', tg_op),
    case when tg_op = 'DELETE' then 'post:deleted' else 'post:updated' end,
    'post:' || v_id, true
  );
  return null;
end;
$$;
revoke all on function public.findback_broadcast_post_change() from public, anon, authenticated;

create or replace function public.findback_broadcast_comment_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_post text;
begin
  v_post := case when tg_op='DELETE' then old.post_id else new.post_id end;
  perform realtime.send(
    jsonb_build_object('postId',v_post,'entity','comment','invalidate',true,'op',tg_op),
    'comment:invalidate','post:'||v_post,true);
  perform realtime.send(jsonb_build_object('invalidate',true),'post:changed','feed',true);
  return null;
end $$;
revoke all on function public.findback_broadcast_comment_change() from public,anon,authenticated;

create or replace function public.findback_broadcast_comment_reaction_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_comment text; v_post text;
begin
  v_comment := case when tg_op='DELETE' then old.comment_id else new.comment_id end;
  select c.post_id into v_post from public.comments c where c.id=v_comment;
  if v_post is null then return null; end if;
  perform realtime.send(
    jsonb_build_object('postId',v_post,'entity','comment_reaction','invalidate',true),
    'reaction:invalidate','post:'||v_post,true);
  perform realtime.send(jsonb_build_object('invalidate',true),'post:changed','feed',true);
  return null;
end $$;
revoke all on function public.findback_broadcast_comment_reaction_change() from public,anon,authenticated;

create or replace function public.findback_broadcast_reaction_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_post text; v_like bigint; v_dislike bigint; v_counts jsonb;
begin
  v_post := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
  select count(*) filter (where r.type = 'LIKE'), count(*) filter (where r.type = 'DISLIKE')
    into v_like, v_dislike from public.reactions r where r.post_id = v_post;
  select coalesce(jsonb_object_agg(t.kind, t.n), '{}'::jsonb) into v_counts
    from (select case when r.type = 'LIKE' then 'LOVE' else r.type end as kind, count(*) as n
          from public.reactions r where r.post_id = v_post group by 1) t;
  perform realtime.send(jsonb_build_object('postId', v_post, 'likeCount', v_like,
    'dislikeCount', v_dislike, 'reactionCounts', v_counts), 'reaction:changed', 'post:' || v_post, true);
  perform realtime.send(jsonb_build_object('invalidate', true), 'post:changed', 'feed', true);
  return null;
end;
$$;
revoke all on function public.findback_broadcast_reaction_change() from public, anon, authenticated;

drop policy if exists findback_realtime_receive_authenticated on realtime.messages;
-- Realtime caches authorization for a connection; a visibility change does not
-- revoke an already joined subscriber until its channel is reauthorized.
create policy findback_realtime_receive_authenticated on realtime.messages for select to authenticated
using (
  topic = 'feed'
  or (topic like 'post:%' and exists (
    select 1 from public.findback_visible_posts p where p.id = substring(topic from 6)
  ))
  or topic = 'notification:' || auth.uid()::text
);
