-- Candidate rows carry the report view counter the feed now projects.
--
-- 20261112130000_report_views.sql appended `view_count` to both feed readers.
-- The match-candidate readers hold a pinned contract: a candidate row is the
-- feed row MINUS the `blocked_author` bit (20261022160000, kept by the P11
-- follow-up 20261102180000). That contract is what lets the shared candidate
-- mapper read a row unchanged, and it is asserted directly against the catalog
-- by supabase/tests/verify_20261022160000_match_candidates_reader.sql (P3-P4).
-- Once the feed migration applied, both candidate readers were one column
-- behind and the parity probe had no row to return.
--
-- Forward-only: every earlier definition is applied and immutable, and
-- PostgreSQL cannot add an OUT column with CREATE OR REPLACE, so both readers
-- are dropped and re-created. Bodies, posture, predicates, page caps and ACLs
-- are unchanged. The single addition is the trailing `view_count`, sourced from
-- the same `item_posts` join the feed reader uses, so the parity holds again.
-- No block bit is projected on the candidate path.
--
-- Static guard: supabase/tests/match_candidates_reader_parity.test.mjs
-- Behavioural guard: supabase/tests/verify_20261022160000_match_candidates_reader.sql
begin;

drop function if exists public.findback_match_candidates_client(text, integer);

create function public.findback_match_candidates_client(
  p_target_id text,
  p_limit integer default 20
)
returns table (
  id text, user_id text, type text, title text, description text, category text,
  status text, event_date text, latitude double precision, longitude double precision,
  location_label text, youtube_url text, created_at text, updated_at text,
  author_username text, author_email_verified integer, author_phone_verified integer,
  author_avatar_url text, author_created_at text, like_count bigint, dislike_count bigint,
  rating_avg numeric, rating_count bigint, comment_count bigint, attachments jsonb,
  total_count bigint, reaction_counts jsonb, reaction_total bigint, my_reaction text,
  view_count bigint
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with target as (
    select t.id, t.type
    from public.findback_visible_posts t
    where t.id = p_target_id and public.findback_can_read_post(t.id)
  ), filtered as (
    select c.*, u.username as author_username,
      u.email_verified as author_email_verified, u.phone_verified as author_phone_verified,
      u.avatar_url as author_avatar_url, u.created_at as author_created_at,
      coalesce(view_post.view_count, 0) as view_count,
      (select count(r.id) from public.reactions r where r.post_id=c.id and r.type='LIKE') as like_count,
      (select count(r.id) from public.reactions r where r.post_id=c.id and r.type='DISLIKE') as dislike_count,
      (select avg(ra.score) from public.ratings ra where ra.post_id=c.id) as rating_avg,
      (select count(ra.id) from public.ratings ra where ra.post_id=c.id) as rating_count,
      (select count(cm.id) from public.comments cm where cm.post_id=c.id) as comment_count,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'post_id',a.post_id,'file_url',a.file_url,'mime_type',a.mime_type,
        'file_name',a.file_name,'file_size',a.file_size,'created_at',a.created_at,
        'display_order',a.display_order,'width',a.width,'height',a.height
      ) order by a.display_order,a.created_at,a.id)
      from public.attachments a where a.post_id=c.id),'[]'::jsonb) as attachments,
      count(*) over() as total_count,
      coalesce((select jsonb_object_agg(t.kind,t.n) from (
        select case when r.type='LIKE' then 'LOVE' else r.type end as kind,count(*) as n
        from public.reactions r where r.post_id=c.id group by 1
      ) t),'{}'::jsonb) as reaction_counts,
      (select count(r.id) from public.reactions r where r.post_id=c.id) as reaction_total,
      (select r.type from public.reactions r where r.post_id=c.id
        and r.user_id=auth.uid()::text limit 1) as my_reaction
    from public.findback_visible_posts c
    join public.item_posts view_post on view_post.id=c.id
    join public.users u on u.id=c.user_id cross join target t
    where c.type<>t.type and c.status='OPEN' and c.id<>t.id
      and c.user_id<>(select auth.uid())::text and not c.blocked_author
      and public.findback_can_read_post(c.id)
  )
  select id,user_id,type,title,description,category,status,event_date,latitude,longitude,
    location_label,youtube_url,created_at,updated_at,author_username,author_email_verified,
    author_phone_verified,author_avatar_url,author_created_at,like_count,dislike_count,
    rating_avg,rating_count,comment_count,attachments,total_count,reaction_counts,
    reaction_total,my_reaction,view_count
  from filtered order by created_at desc,id desc
  limit least(greatest(coalesce(p_limit,20),1),20);
$$;
revoke all on function public.findback_match_candidates_client(text,integer) from public,anon;
grant execute on function public.findback_match_candidates_client(text,integer) to authenticated;
comment on function public.findback_match_candidates_client(text,integer) is
  'Legacy compatibility reader; governed definer aggregates, explicit target/candidate visibility. Shipping matching uses v2. Legacy ratings are not recovery reputation. Carries the feed row minus the block bit, including the feed''s trailing view_count.';

drop function if exists public.findback_match_candidates_v2(text, integer);

create function public.findback_match_candidates_v2(
  p_target_id text,
  p_limit integer default 80
)
returns table (
  id text, user_id text, type text, title text, description text, category text,
  status text, event_date text, latitude double precision, longitude double precision,
  location_label text, youtube_url text, created_at text, updated_at text,
  author_username text, author_email_verified integer, author_phone_verified integer,
  author_avatar_url text, author_created_at text,
  like_count bigint, dislike_count bigint, rating_avg numeric, rating_count bigint,
  comment_count bigint, attachments jsonb, total_count bigint,
  reaction_counts jsonb, reaction_total bigint, my_reaction text,
  view_count bigint
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with target as materialized (
    select t.*,
      tsvector_to_array(to_tsvector('pg_catalog.simple',
        left(coalesce(t.title,''),512)||' '||left(coalesce(t.description,''),4096)||' '||
        left(coalesce(t.location_label,''),512))) as words,
      case when t.event_date ~ '^\d{4}-\d{2}-\d{2}$'
        and pg_input_is_valid(t.event_date,'date') then t.event_date::date end as event_day
    from public.findback_visible_posts t
    where t.id=p_target_id and t.status='OPEN' and not t.blocked_author and findback_can_read_post(t.id)
      and (select auth.uid()) is not null
  ), eligible as (
    select c.*, u.username as author_username,
      u.email_verified as author_email_verified, u.phone_verified as author_phone_verified,
      u.avatar_url as author_avatar_url, u.created_at as author_created_at,
      coalesce(view_post.view_count, 0) as view_count,
      t.category as target_category, t.words as target_words, t.event_day as target_day,
      t.latitude as target_latitude, t.longitude as target_longitude,
      tsvector_to_array(to_tsvector('pg_catalog.simple',
        left(coalesce(c.title,''),512)||' '||left(coalesce(c.description,''),4096)||' '||
        left(coalesce(c.location_label,''),512))) as words,
      case when c.event_date ~ '^\d{4}-\d{2}-\d{2}$'
        and pg_input_is_valid(c.event_date,'date') then c.event_date::date end as event_day,
      case when left(c.created_at,10) ~ '^\d{4}-\d{2}-\d{2}$'
        and pg_input_is_valid(left(c.created_at,10),'date') then left(c.created_at,10)::date end as created_day
    from public.findback_visible_posts c
    join public.item_posts view_post on view_post.id=c.id
    join public.users u on u.id=c.user_id
    cross join target t
    where c.type<>t.type and c.status='OPEN' and c.id<>t.id and findback_can_read_post(c.id)
      and c.user_id<>(select auth.uid())::text and c.user_id<>t.user_id
      and not c.blocked_author
  ), scored as (
    select e.*,
      0.35 * case when e.category=e.target_category then 1 else 0 end
      + 0.35 * (select count(*)::double precision from unnest(e.words) w
          where w=any(e.target_words)) / greatest(cardinality(e.words),cardinality(e.target_words),1)
      + case when e.event_day is not null and e.target_day is not null
          then 0.15/(1+abs(e.event_day-e.target_day)/30.0) else 0 end
      + case when e.latitude between -90 and 90 and e.longitude between -180 and 180
          and e.target_latitude between -90 and 90 and e.target_longitude between -180 and 180
          then 0.10/(1+6371*acos(least(1.0,greatest(-1.0,
            sin(radians(e.latitude))*sin(radians(e.target_latitude))
            +cos(radians(e.latitude))*cos(radians(e.target_latitude))
             *cos(radians(e.longitude-e.target_longitude)))))/25) else 0 end
      + case when e.created_day is not null
          then 0.05/(1+greatest(current_date-e.created_day,0)/30.0) else 0 end as relevance
    from eligible e
  ), pool as materialized (
    select s.*, count(*) over() as total_count
    from scored s
    order by relevance desc, created_at desc, id desc
    limit least(greatest(coalesce(p_limit,80),1),80)
  )
  -- Expensive social/media projection happens only after relevance selection.
  select c.id, c.user_id, c.type, c.title, c.description, c.category, c.status,
    c.event_date, c.latitude, c.longitude, c.location_label, c.youtube_url,
    c.created_at, c.updated_at, c.author_username, c.author_email_verified,
    c.author_phone_verified, c.author_avatar_url, c.author_created_at,
    (select count(r.id) from public.reactions r where r.post_id=c.id and r.type='LIKE'),
    (select count(r.id) from public.reactions r where r.post_id=c.id and r.type='DISLIKE'),
    (select avg(r.score) from public.ratings r where r.post_id=c.id),
    (select count(r.id) from public.ratings r where r.post_id=c.id),
    (select count(cm.id) from public.comments cm where cm.post_id=c.id and findback_can_read_comment(cm.id)),
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'post_id',a.post_id,'file_url',a.file_url,'mime_type',a.mime_type,
      'file_name',a.file_name,'file_size',a.file_size,'created_at',a.created_at,
      'display_order',a.display_order,'width',a.width,'height',a.height)
      order by a.display_order asc,a.created_at asc,a.id asc)
      from public.attachments a where a.post_id=c.id),'[]'::jsonb),
    c.total_count,
    coalesce((select jsonb_object_agg(r.kind,r.n) from (
      select case when rx.type='LIKE' then 'LOVE' else rx.type end as kind,count(*) as n
      from public.reactions rx where rx.post_id=c.id group by 1
    ) r),'{}'::jsonb),
    (select count(r.id) from public.reactions r where r.post_id=c.id),
    (select r.type from public.reactions r where r.post_id=c.id and r.user_id=auth.uid()::text limit 1),
    c.view_count
  from pool c
  order by c.relevance desc,c.created_at desc,c.id desc;
$$;

revoke all on function public.findback_match_candidates_v2(text,integer) from public,anon;
grant execute on function public.findback_match_candidates_v2(text,integer) to authenticated;
comment on function public.findback_match_candidates_v2(text,integer) is
  'Authenticated definer relevance pool: existing visible-view/RLS and block exclusion before category/text-locality/date/geo/recency ordering, then 1..80 cap. Open opposite-type candidates exclude viewer and target author. Missing location and long-running losses are not hard-filtered. Candidate projection matches the legacy reader, no block bit or confidence score, and carries the feed''s trailing view_count. Local semantic/text ranking remains stage two.';

commit;
