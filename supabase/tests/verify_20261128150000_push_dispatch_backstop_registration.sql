-- Catalog readback only: this file sends no request and leaves nothing behind
-- (the registration it performs is rolled back). Run after the migration chain
-- in a disposable database.
--
-- 20261128150000_push_dispatch_backstop_registration.sql must leave the
-- per-minute retry backstop registerable on a platform where the migration role
-- may not write the scheduler's job table: the helper removes the old job through
-- `cron.unschedule`, its body reaches the job table nowhere except the existence
-- probe, it stays SECURITY DEFINER and internal-only, and on a cluster without
-- pg_cron it reports 'unavailable' without creating anything.
begin;
do $$
declare
  v_body text;
  v_definer boolean;
  v_config text[];
  v_returns text;
  v_mentions integer;
  v_probes integer;
  v_jobs integer;
begin
  -- The helper still exists with the reviewed signature: text result, SECURITY
  -- DEFINER, and a search_path it locks itself.
  select p.prosrc, p.prosecdef, p.proconfig, pg_get_function_result(p.oid)
    into v_body, v_definer, v_config, v_returns
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'findback_schedule_push_dispatch'
    and p.pronargs = 0;
  if v_body is null then
    raise exception 'public.findback_schedule_push_dispatch() does not exist';
  end if;
  if v_returns <> 'text' then
    raise exception 'the push dispatch scheduler no longer returns text: %', v_returns;
  end if;
  if not v_definer then
    raise exception 'the push dispatch scheduler is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from unnest(coalesce(v_config, '{}'::text[])) as c
                 where c like 'search_path=%' and c like '%public%' and c like '%pg_temp%') then
    raise exception 'the push dispatch scheduler does not lock search_path';
  end if;

  -- The repair itself: removal goes through the pg_cron API the migration role
  -- holds, and the body never reaches the job table. The only mention allowed is
  -- the `to_regclass` existence probe, exactly once; the old helper's read and
  -- write of that table is what raised 42501 and left 'failed'.
  if v_body not like '%cron.unschedule%' then
    raise exception 'the scheduler does not remove the old job through cron.unschedule';
  end if;
  if v_body like '%delete%' then
    raise exception 'the scheduler still deletes rows directly, which this platform denies';
  end if;
  v_mentions := (length(v_body) - length(replace(v_body, 'cron.job', ''))) / length('cron.job');
  v_probes := (length(v_body) - length(replace(v_body, 'to_regclass(''cron.job'')', '')))
    / length('to_regclass(''cron.job'')');
  if v_mentions <> 1 or v_probes <> 1 then
    raise exception 'the scheduler names the job table outside its existence probe (mentions %, probes %)',
      v_mentions, v_probes;
  end if;

  -- The cadence and the command are unchanged: one call a minute, draining every
  -- pending notification.
  if v_body not like '%''* * * * *''%' then
    raise exception 'the push retry backstop is not registered every minute';
  end if;
  if v_body not like '%cron.schedule%' or v_body not like '%findback_push_dispatch_now%' then
    raise exception 'the scheduler does not register the dispatcher';
  end if;

  -- The write-time path this backstop backs up is untouched by this migration.
  if not exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.notifications'::regclass
                   and t.tgname = 'trg_findback_push_dispatch_notification'
                   and not t.tgisinternal
                   and t.tgenabled = 'O') then
    raise exception 'this migration disturbed the write-time push dispatch trigger';
  end if;

  -- No client role may call the helper, before or after the repair.
  if has_function_privilege('anon','public.findback_schedule_push_dispatch()','EXECUTE')
     or has_function_privilege('authenticated','public.findback_schedule_push_dispatch()','EXECUTE') then
    raise exception 'a client role can reach the push dispatch scheduler';
  end if;

  if to_regclass('cron.job') is null then
    -- No extension here: registration must report that and create nothing, so a
    -- plain PostgreSQL chain stays applicable.
    if public.findback_schedule_push_dispatch() <> 'unavailable' then
      raise exception 'push dispatch registration claimed a schedule without pg_cron';
    end if;
    if exists (select 1 from pg_namespace where nspname = 'cron') then
      raise exception 'push dispatch registration created a cron schema without the extension';
    end if;
  else
    -- Called twice in a row, which is what a re-deploy and a retried migration do:
    -- unschedule-then-schedule must converge on one job, never two.
    if public.findback_schedule_push_dispatch() <> 'scheduled' then
      raise exception 'the push retry backstop was not registered';
    end if;
    if public.findback_schedule_push_dispatch() <> 'scheduled' then
      raise exception 'the push retry backstop failed on a second registration';
    end if;
    select count(*) into v_jobs from cron.job
    where jobname = 'findback_push_dispatch'
      and schedule = '* * * * *'
      and command like '%findback_push_dispatch_now%';
    if v_jobs <> 1 then
      raise exception 'the per-minute push dispatch backstop is registered % times (want exactly one)', v_jobs;
    end if;
    select count(*) into v_jobs from cron.job where jobname = 'findback_push_dispatch';
    if v_jobs <> 1 then
      raise exception 'a second job under the same name survived registration (% rows)', v_jobs;
    end if;
  end if;
end $$;
select 'PASS push dispatch backstop registers through cron.unschedule without writing the job table' as result;
rollback;
