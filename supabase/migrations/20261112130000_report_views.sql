begin;

alter table public.item_posts add column view_count bigint not null default 0;
grant select (view_count) on public.item_posts to authenticated;

create table public.report_views (
  report_id text not null references public.item_posts(id) on delete cascade,
  viewer_id text not null references public.users(id) on delete cascade,
  viewed_on date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (report_id, viewer_id, viewed_on)
);
create index report_views_viewed_on_idx on public.report_views (viewed_on);
alter table public.report_views enable row level security;
create policy report_views_insert_own on public.report_views for insert to authenticated
  with check (viewer_id = (select auth.uid())::text and viewed_on = current_date
    and exists (select 1 from public.findback_visible_posts p where p.id = report_id));
revoke all on public.report_views from public, anon, authenticated;
grant insert (report_id, viewer_id) on public.report_views to authenticated;

-- The trigger covers both the RPC and permitted direct inserts, and fires only
-- for rows actually inserted, never for ON CONFLICT DO NOTHING or retention.
create function public.findback_increment_report_view() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.item_posts set view_count = view_count + 1 where id = new.report_id;
  return new;
end;
$$;
revoke all on function public.findback_increment_report_view() from public, anon, authenticated;
create trigger report_views_increment after insert on public.report_views
  for each row execute function public.findback_increment_report_view();

create function public.findback_record_report_view(p_report_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_viewer text := auth.uid()::text;
begin
  if v_viewer is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.item_posts p where p.id = p_report_id::text
    and (p.user_id = v_viewer or p.moderation_visibility = 'PUBLISHED')) then
    return;
  end if;
  insert into public.report_views (report_id, viewer_id)
    values (p_report_id::text, v_viewer) on conflict do nothing;
end;
$$;
revoke all on function public.findback_record_report_view(uuid) from public, anon, authenticated;
grant execute on function public.findback_record_report_view(uuid) to authenticated;

-- Retain deduplication rows for 90 days by default; the lifetime counter is
-- intentionally not decremented. Scheduling is a deployment decision.
create function public.findback_prune_report_views(p_older_than_days int default 90) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_older_than_days is null or p_older_than_days < 1 then
    raise exception 'retention must be at least one day' using errcode = '22023';
  end if;
  delete from public.report_views where viewed_on < current_date - p_older_than_days;
end;
$$;
revoke all on function public.findback_prune_report_views(int) from public, anon, authenticated;
grant execute on function public.findback_prune_report_views(int) to service_role;

drop function if exists public.findback_query_posts_client(text, text, text, text, text, text, text, text, text, text, integer, text);

create function public.findback_query_posts_client(
  p_user_id text default null,
  p_type text default null,
  p_category text default null,
  p_status text default null,
  p_q text default null,
  p_date_from text default null,
  p_date_to text default null,
  p_cursor_created_at text default null,
  p_cursor_id text default null,
  p_order text default 'desc',
  p_limit integer default 10,
  p_post_id text default null
)
returns table (
  id text,
  user_id text,
  type text,
  title text,
  description text,
  category text,
  status text,
  event_date text,
  latitude double precision,
  longitude double precision,
  location_label text,
  youtube_url text,
  created_at text,
  updated_at text,
  author_username text,
  author_email_verified integer,
  author_phone_verified integer,
  author_avatar_url text,
  author_created_at text,
  like_count bigint,
  dislike_count bigint,
  rating_avg numeric,
  rating_count bigint,
  comment_count bigint,
  attachments jsonb,
  total_count bigint,
  reaction_counts jsonb,
  reaction_total bigint,
  my_reaction text,
  blocked_author boolean,
  view_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with filtered as (
    select
      p.*,
      coalesce(view_post.view_count, 0) as view_count,
      u.username as author_username,
      u.email_verified as author_email_verified,
      u.phone_verified as author_phone_verified,
      u.avatar_url as author_avatar_url,
      u.created_at as author_created_at,
      (select count(r.id) from reactions r where r.post_id = p.id and r.type = 'LIKE') as like_count,
      (select count(r.id) from reactions r where r.post_id = p.id and r.type = 'DISLIKE') as dislike_count,
      (select avg(ra.score) from ratings ra where ra.post_id = p.id) as rating_avg,
      (select count(ra.id) from ratings ra where ra.post_id = p.id) as rating_count,
      (select count(c.id) from comments c where c.post_id = p.id) as comment_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'post_id', a.post_id,
            'file_url', a.file_url,
            'mime_type', a.mime_type,
            'file_name', a.file_name,
            'file_size', a.file_size,
            'created_at', a.created_at,
            'display_order', a.display_order,
            'width', a.width,
            'height', a.height
          ) order by a.display_order asc, a.created_at asc, a.id asc
        )
        from attachments a
        where a.post_id = p.id
      ), '[]'::jsonb) as attachments,
      count(*) over() as total_count,
      coalesce((
        select jsonb_object_agg(t.kind, t.n)
        from (
          select case when r.type = 'LIKE' then 'LOVE' else r.type end as kind,
                 count(*) as n
          from public.reactions r
          where r.post_id = p.id
          group by 1
        ) t
      ), '{}'::jsonb) as reaction_counts,
      (select count(r.id) from reactions r where r.post_id = p.id) as reaction_total,
      (select r.type from reactions r
        where r.post_id = p.id and r.user_id = auth.uid()::text
        limit 1) as my_reaction
    from public.findback_visible_posts p
    join public.item_posts view_post on view_post.id = p.id
    join users u on u.id = p.user_id
    where
      (p_post_id is null or p.id = p_post_id)
      and (p_user_id is null or p.user_id = p_user_id)
      and (p_type is null or p.type = p_type)
      and (p_category is null or p.category = p_category)
      and (p_status is null or p.status = p_status)
      and (
        p_q is null
        or lower(p.title) like '%' || lower(p_q) || '%'
        or lower(p.description) like '%' || lower(p_q) || '%'
      )
      and (p_date_from is null or p.event_date >= p_date_from)
      and (p_date_to is null or p.event_date <= p_date_to)
  )
  select
    id,
    user_id,
    type,
    title,
    description,
    category,
    status,
    event_date,
    latitude,
    longitude,
    location_label,
    youtube_url,
    created_at,
    updated_at,
    author_username,
    author_email_verified,
    author_phone_verified,
    author_avatar_url,
    author_created_at,
    like_count,
    dislike_count,
    rating_avg,
    rating_count,
    comment_count,
    attachments,
    total_count,
    reaction_counts,
    reaction_total,
    my_reaction,
    blocked_author,
    view_count
  from filtered
  where
    p_cursor_created_at is null
    or (
      p_order = 'asc'
      and (
        created_at > p_cursor_created_at
        or (created_at = p_cursor_created_at and id > coalesce(p_cursor_id, ''))
      )
    )
    or (
      p_order <> 'asc'
      and (
        created_at < p_cursor_created_at
        or (created_at = p_cursor_created_at and id < coalesce(p_cursor_id, ''))
      )
    )
  order by
    (case when p_order = 'asc' then created_at end) asc,
    (case when p_order = 'asc' then id end) asc,
    (case when p_order <> 'asc' then created_at end) desc,
    (case when p_order <> 'asc' then id end) desc
  limit least(greatest(p_limit, 0), 20);
$$;

revoke all on function public.findback_query_posts_client(  text, text, text, text, text, text, text, text, text, text, integer, text) from public;

revoke all on function public.findback_query_posts_client(  text, text, text, text, text, text, text, text, text, text, integer, text) from anon;

grant execute on function public.findback_query_posts_client(  text, text, text, text, text, text, text, text, text, text, integer, text) to authenticated;

comment on function public.findback_query_posts_client(  text, text, text, text, text, text, text, text, text, text, integer, text)
  is $cmt$FindBack client feed/listing (authenticated): post + public author + aggregates + display_order-ranked attachments with keyset pagination, exact post lookup and total_count window. reaction_counts/reaction_total/my_reaction are the canonical reaction truth (LIKE folded to LOVE); like_count/dislike_count remain as compat. Never returns author email/phone. Page size clamped to 20. blocked_author is the caller-scoped, direction-free O5 signal (true when a block relationship exists between the caller and this row's author); it is projected LAST and never filters a row.$cmt$;


drop function if exists public.findback_query_posts_nearby_client(text, text, text, text, text, text, text, text, text, text, integer, double precision, double precision, double precision);

create function public.findback_query_posts_nearby_client(
  p_user_id text default null,
  p_type text default null,
  p_category text default null,
  p_status text default null,
  p_q text default null,
  p_date_from text default null,
  p_date_to text default null,
  p_cursor_created_at text default null,
  p_cursor_id text default null,
  p_order text default 'desc',
  p_limit integer default 10,
  p_near_lat double precision default null,
  p_near_lng double precision default null,
  p_radius_m double precision default null
)
returns table (
  id text,
  user_id text,
  type text,
  title text,
  description text,
  category text,
  status text,
  event_date text,
  latitude double precision,
  longitude double precision,
  location_label text,
  youtube_url text,
  created_at text,
  updated_at text,
  author_username text,
  author_email_verified integer,
  author_phone_verified integer,
  author_avatar_url text,
  author_created_at text,
  like_count bigint,
  dislike_count bigint,
  rating_avg numeric,
  rating_count bigint,
  comment_count bigint,
  attachments jsonb,
  total_count bigint,
  reaction_counts jsonb,
  reaction_total bigint,
  my_reaction text,
  blocked_author boolean,
  view_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with filtered as (
    select
      p.*,
      coalesce(view_post.view_count, 0) as view_count,
      u.username as author_username,
      u.email_verified as author_email_verified,
      u.phone_verified as author_phone_verified,
      u.avatar_url as author_avatar_url,
      u.created_at as author_created_at,
      (select count(r.id) from reactions r where r.post_id = p.id and r.type = 'LIKE') as like_count,
      (select count(r.id) from reactions r where r.post_id = p.id and r.type = 'DISLIKE') as dislike_count,
      (select avg(ra.score) from ratings ra where ra.post_id = p.id) as rating_avg,
      (select count(ra.id) from ratings ra where ra.post_id = p.id) as rating_count,
      (select count(c.id) from comments c where c.post_id = p.id) as comment_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'post_id', a.post_id,
            'file_url', a.file_url,
            'mime_type', a.mime_type,
            'file_name', a.file_name,
            'file_size', a.file_size,
            'created_at', a.created_at,
            'display_order', a.display_order,
            'width', a.width,
            'height', a.height
          ) order by a.display_order asc, a.created_at asc, a.id asc
        )
        from attachments a
        where a.post_id = p.id
      ), '[]'::jsonb) as attachments,
      count(*) over() as total_count,
      coalesce((
        select jsonb_object_agg(t.kind, t.n)
        from (
          select case when r.type = 'LIKE' then 'LOVE' else r.type end as kind,
                 count(*) as n
          from public.reactions r
          where r.post_id = p.id
          group by 1
        ) t
      ), '{}'::jsonb) as reaction_counts,
      (select count(r.id) from reactions r where r.post_id = p.id) as reaction_total,
      (select r.type from reactions r
        where r.post_id = p.id and r.user_id = auth.uid()::text
        limit 1) as my_reaction
    from public.findback_visible_posts p
    join public.item_posts view_post on view_post.id = p.id
    join users u on u.id = p.user_id
    where
      (p_user_id is null or p.user_id = p_user_id)
      and (p_type is null or p.type = p_type)
      and (p_category is null or p.category = p_category)
      and (p_status is null or p.status = p_status)
      and (
        p_q is null
        or lower(p.title) like '%' || lower(p_q) || '%'
        or lower(p.description) like '%' || lower(p_q) || '%'
      )
      and (p_date_from is null or p.event_date >= p_date_from)
      and (p_date_to is null or p.event_date <= p_date_to)
      -- Only rows with numeric coordinates can be proven nearby; typed-only
      -- posts are excluded from this scope by design.
      and p.latitude is not null
      and p.longitude is not null
      and (
        p_near_lat is null
        or p_near_lng is null
        or p_radius_m is null
        or (
          6371000 * 2 * asin(sqrt(least(1, greatest(0,
            power(sin(radians(p.latitude - p_near_lat) / 2), 2)
            + cos(radians(p_near_lat)) * cos(radians(p.latitude))
              * power(sin(radians(p.longitude - p_near_lng) / 2), 2)
          )))) <= p_radius_m
        )
      )
  )
  select
    id,
    user_id,
    type,
    title,
    description,
    category,
    status,
    event_date,
    latitude,
    longitude,
    location_label,
    youtube_url,
    created_at,
    updated_at,
    author_username,
    author_email_verified,
    author_phone_verified,
    author_avatar_url,
    author_created_at,
    like_count,
    dislike_count,
    rating_avg,
    rating_count,
    comment_count,
    attachments,
    total_count,
    reaction_counts,
    reaction_total,
    my_reaction,
    blocked_author,
    view_count
  from filtered
  where
    p_cursor_created_at is null
    or (
      p_order = 'asc'
      and (
        created_at > p_cursor_created_at
        or (created_at = p_cursor_created_at and id > coalesce(p_cursor_id, ''))
      )
    )
    or (
      p_order <> 'asc'
      and (
        created_at < p_cursor_created_at
        or (created_at = p_cursor_created_at and id < coalesce(p_cursor_id, ''))
      )
    )
  order by
    (case when p_order = 'asc' then created_at end) asc,
    (case when p_order = 'asc' then id end) asc,
    (case when p_order <> 'asc' then created_at end) desc,
    (case when p_order <> 'asc' then id end) desc
  limit least(greatest(p_limit, 0), 20);
$$;

revoke all on function public.findback_query_posts_nearby_client(  text, text, text, text, text, text, text, text, text, text, integer,
  double precision, double precision, double precision) from public;

revoke all on function public.findback_query_posts_nearby_client(  text, text, text, text, text, text, text, text, text, text, integer,
  double precision, double precision, double precision) from anon;

grant execute on function public.findback_query_posts_nearby_client(  text, text, text, text, text, text, text, text, text, text, integer,
  double precision, double precision, double precision) to authenticated;

comment on function public.findback_query_posts_nearby_client(  text, text, text, text, text, text, text, text, text, text, integer,
  double precision, double precision, double precision)
  is $cmt$FindBack nearby feed (authenticated): client feed filters plus Haversine radius scope (p_near_lat, p_near_lng, p_radius_m). Only map-pin rows qualify; total_count is the full proximity-filtered total before the keyset cursor. reaction_counts/reaction_total/my_reaction are the canonical reaction truth (LIKE folded to LOVE); like_count/dislike_count remain as compat. Attachments are display_order-ranked. Never returns author email/phone or distance. Page size clamped to 20. blocked_author is the caller-scoped, direction-free O5 signal (true when a block relationship exists between the caller and this row's author); it is projected LAST and never filters a row.$cmt$;


commit;
