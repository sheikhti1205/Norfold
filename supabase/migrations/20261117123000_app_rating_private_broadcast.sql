-- Audit 2026-11-17: the app-rating aggregate was a client-published
-- public broadcast.
--
-- `FeedbackForm` called `publishAppRatingAggregate` after its own write, so the
-- event depended on the rating client staying open, and the `app-rating` topic
-- had no receive policy at all: `private: false` broadcast to anyone who knew
-- the topic name. The payload was only an aggregate, but the transport was
-- still public and the delivery was still client-owned.
--
-- The server now emits it. A trigger on `app_experience_ratings` computes the
-- same aggregate `findback_app_rating_context` returns and sends it on the
-- private `app-rating` topic; the receive policy admits authenticated readers
-- only. The client stops publishing and subscribes with `private: true`.
begin;

create or replace function public.findback_emit_app_rating()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_average numeric;
  v_count   bigint;
begin
  select round(avg(score), 1), count(*)
    into v_average, v_count
    from public.app_experience_ratings;

  begin
    perform realtime.send(
      jsonb_build_object('average', v_average, 'count', v_count),
      'rating:changed',
      'app-rating',
      true
    );
  exception when others then
    -- The rating write is the product action. A broadcast failure must not
    -- fail it; the next screen read repairs the aggregate.
    null;
  end;

  return null;
end;
$$;

revoke all on function public.findback_emit_app_rating() from public, anon, authenticated;

drop trigger if exists findback_app_rating_emit on public.app_experience_ratings;
create trigger findback_app_rating_emit
  after insert or update or delete on public.app_experience_ratings
  for each row execute function public.findback_emit_app_rating();

-- The private receive gate: the same authenticated reader who can open the
-- feedback screen may receive this aggregate. Nothing else changes.
drop policy if exists findback_realtime_receive_authenticated on realtime.messages;
create policy findback_realtime_receive_authenticated
  on realtime.messages for select to authenticated
  using (
    topic = 'feed'
    or topic = 'app-rating'
    or (topic like 'post:%' and exists (
      select 1 from public.findback_visible_posts p
      where p.id = substring(realtime.messages.topic from 6)
    ))
    or topic = 'notification:' || (select auth.uid())::text
  );

commit;
