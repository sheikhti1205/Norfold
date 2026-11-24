-- Correction 2026-11-12: the frequency limit is too strict.
--
-- What was wrong: the guard refused a write whenever ANY previous write by the
-- same reader was less than `burst_cooldown_seconds` old, and that value is 60 s
-- for TRUSTED, 90 s for NORMAL, 120 s below that. So two comments 30 seconds
-- apart were refused, and the message read "You're posting too quickly". That is
-- per-write spacing dressed up as burst protection: it stops ordinary people
-- having a conversation, and a script that waits 91 seconds walks straight
-- through it.
--
-- What replaces it: a real burst rule. A reader may write up to ten times inside
-- one second; the eleventh write in that window is refused with the same
-- POST_COOLDOWN word, so every client surface keeps its existing copy. The daily
-- ceiling (`limit_per_day`) is untouched and remains the bound on sustained
-- volume, and probation keeps the protected admission ledger it already uses.
--
-- The window is measured between the reader's own rows rather than against the
-- server clock. `created_at` is client-supplied (`text not null`, no default), so
-- a phone with a clock a minute slow would otherwise never trip a server-clock
-- window. Differencing two client timestamps removes that skew. It does not make
-- the rule tamper-proof: a client that deliberately backdates rows can still
-- step outside the window. The daily ceiling and the admission ledger are the
-- security bounds; this is a speed bump for accidental floods.
--
-- Scope: BRANCH replacement of `findback_enforce_interaction_limit` only.
-- `findback_post_limit_for` / `findback_post_limit` keep their shape and values,
-- because `fetchPostLimit()` in the client validates both columns and would
-- throw UNEXPECTED_SHAPE if the row changed. Nothing else changes: same advisory
-- lock, same UTC day sampled after the lock, same standing refusal, same daily
-- ceiling, same words.

begin;

create or replace function public.findback_enforce_interaction_limit()
returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  -- The burst rule. Ten writes in one second is not a person typing.
  v_burst_max constant integer := 10;
  v_burst_window constant interval := interval '1 second';

  v_uid text := auth.uid()::text;
  v_actor text := btrim(coalesce(new.user_id, ''));
  v_self boolean;
  v_probation boolean;
  v_limit integer;
  v_count integer;
  v_burst_count integer;
  v_day_start timestamptz;
begin
  if v_actor = '' then
    return new;
  end if;

  v_self := coalesce(v_uid = v_actor, false);

  perform pg_advisory_xact_lock(hashtextextended('findback_public_admission:' || v_actor, 0));
  v_day_start := (date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc');
  v_probation := public.findback_active_sanction_kind(v_actor) = 'PROBATION';

  if v_probation then
    select l.limit_per_day into v_limit from public.findback_post_limit_for(v_actor) l;
    if v_limit <= 0 then
      raise exception 'POST_NOT_AVAILABLE: your account cannot post or comment right now' using errcode = 'P0001';
    end if;
    select count(*) into v_count
      from public.public_action_admissions a
     where a.user_id = v_actor
       and a.action_kind = case tg_table_name when 'item_posts' then 'POST' else 'COMMENT' end
       and a.admitted_at >= v_day_start;
    if tg_table_name = 'item_posts' then
      select greatest(v_count, count(*)) into v_count
        from public.item_posts p
       where p.user_id = v_actor
         and nullif(btrim(p.created_at), '')::timestamptz >= v_day_start;
    else
      select greatest(v_count, count(*)) into v_count
        from public.comments c
       where c.user_id = v_actor
         and nullif(btrim(c.created_at), '')::timestamptz >= v_day_start;
    end if;
    if v_count >= v_limit then
      raise exception 'POST_LIMIT_REACHED: you have reached today''s limit of %', v_limit using errcode = 'P0001';
    end if;
    perform public.findback_public_admission_check(v_actor,
      case tg_table_name when 'item_posts' then 'POST' else 'COMMENT' end);
    return new;
  end if;

  if not v_self then
    return new;
  end if;

  select l.limit_per_day into v_limit from public.findback_post_limit_for(v_actor) l;
  if v_limit <= 0 then
    raise exception 'POST_NOT_AVAILABLE: your account cannot post or comment right now' using errcode = 'P0001';
  end if;

  if tg_table_name = 'item_posts' then
    select count(*) into v_count
      from public.item_posts p
     where p.user_id = v_actor
       and nullif(btrim(p.created_at), '')::timestamptz >= v_day_start;
  else
    select count(*) into v_count
      from public.comments c
     where c.user_id = v_actor
       and nullif(btrim(c.created_at), '')::timestamptz >= v_day_start;
  end if;

  if v_count >= v_limit then
    raise exception 'POST_LIMIT_REACHED: you have reached today''s limit of %', v_limit using errcode = 'P0001';
  end if;

  -- Burst: how many of this reader's writes already sit within `v_burst_window`
  -- of their newest write, counting reports and comments together. Ten is a
  -- flood; eleven in a row is refused.
  with writes as (
    select nullif(btrim(p.created_at), '')::timestamptz as at
      from public.item_posts p
     where p.user_id = v_actor
    union all
    select nullif(btrim(c.created_at), '')::timestamptz as at
      from public.comments c
     where c.user_id = v_actor
  ), newest as (
    select max(at) as top from writes
  )
  select count(*) into v_burst_count
    from writes, newest
   where writes.at is not null
     and newest.top is not null
     and writes.at > newest.top - v_burst_window;

  if v_burst_count >= v_burst_max then
    raise exception 'POST_COOLDOWN: more than % writes in a second', v_burst_max using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke all on function public.findback_enforce_interaction_limit() from public, anon, authenticated;
comment on function public.findback_enforce_interaction_limit() is
  'FindBack interaction limit guard (definer, internal trigger): samples the UTC day after the actor lock, refuses with P0001 POST_LIMIT_REACHED/POST_NOT_AVAILABLE, and enforces a burst rule of at most 10 writes per second across reports and comments (POST_COOLDOWN). Per-write spacing is deliberately gone: 60-120 s between two comments stopped conversations, not spam.';

commit;
