-- Push dispatch backstop registration repair.
--
-- WHAT WAS WRONG. 20261128140000_push_dispatch_write_time.sql re-registers the
-- per-minute retry job by deleting the old row from `cron.job` before calling
-- `cron.schedule`. On this platform the migration role `postgres` holds EXECUTE
-- on `cron.schedule` and `cron.unschedule` but no privilege on the `cron.job`
-- table, so that DELETE raised 42501 "permission denied for table job". The
-- registration block's exception handler caught it, raised a warning and
-- returned 'failed'. The write-time trigger still works; what never existed was
-- the backstop that retries a dispatch the trigger missed. That file is already
-- applied and recorded in `supabase_migrations.schema_migrations`, so editing it
-- would not re-run it: this file replaces the helper instead.
--
-- WHY `cron.unschedule`. It is the supported API for removing a job by name and
-- it runs with the privilege the migration role actually holds. It is wrapped in
-- its own exception block, so a name that matches nothing (the first ever
-- registration) or a pg_cron build without that overload cannot abort the
-- registration that follows. Removing by name is still what keeps a re-run from
-- accumulating duplicate jobs or silently keeping the old cadence. Nothing in
-- this body reads or writes the `cron.job` table; that is the whole point of the
-- repair.
--
-- WHAT IS NOT CHANGED. The write-time trigger
-- `trg_findback_push_dispatch_notification`, the dispatcher
-- `public.findback_push_dispatch_now()` and its trigger wrapper
-- `public.findback_push_dispatch_on_notification()` all exist and work and are
-- not recreated here. Only the registration helper's body is replaced, and the
-- grants that keep the surface internal-only are repeated so that contract is
-- stated once more in the file that changes the helper. A cluster without
-- pg_cron still applies this file unchanged: it warns, creates no `cron` schema
-- and returns 'unavailable'.
--
-- LIVE-PENDING.
-- supabase/tests/verify_20261128150000_push_dispatch_backstop_registration.sql
-- proves from the catalog that the helper is still SECURITY DEFINER, that its
-- body names `cron.unschedule` and mentions the job table only in its
-- `to_regclass` existence probe, that it returns 'unavailable' where the
-- extension is absent, and, on a cluster that has one, that calling it twice
-- leaves exactly one `* * * * *` job calling the dispatcher. That a registered
-- job then actually fires is observable in `cron.job_run_details`.
begin;

-- Registration. Idempotent and inert on a cluster without the extensions, exactly
-- like the media-worker scheduler, so the disposable chain harness applies this
-- file unchanged and the live project registers itself.
create or replace function public.findback_schedule_push_dispatch()
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_net boolean := false;
begin
 begin
  execute 'create extension if not exists pg_cron with schema pg_catalog';
 exception when others then
  raise warning 'pg_cron is unavailable (%); the push retry backstop stays unregistered', sqlerrm;
 end;
 begin
  execute 'create extension if not exists pg_net with schema extensions';
  v_net := true;
 exception when others then
  raise warning 'pg_net is unavailable (%); engagement push stays on the scheduled drain', sqlerrm;
 end;
 if v_net then
  begin
   execute 'grant usage on schema net to postgres';
   execute 'grant execute on function net.http_post(text,jsonb,jsonb,jsonb,integer) to postgres';
  exception when others then
   raise warning 'pg_net access was not granted (%)', sqlerrm;
  end;
 end if;
 if to_regclass('cron.job') is null then return 'unavailable'; end if;
 begin
  execute 'grant usage on schema cron to postgres';
  execute 'grant all privileges on all tables in schema cron to postgres';
 exception when others then
  raise warning 'cron schema access was not granted (%)', sqlerrm;
 end;
 -- Re-registering by name is the only supported re-run path. The job is removed
 -- through the pg_cron API this role may call, instead of touching the
 -- scheduler's own table. That removal has its own handler because the first
 -- registration has no job to remove and must not be reported as a failure for
 -- that reason.
 begin
  begin
   perform cron.unschedule('findback_push_dispatch');
  exception when others then
   null;
  end;
  perform cron.schedule('findback_push_dispatch','* * * * *',
   'select public.findback_push_dispatch_now()');
  return 'scheduled';
 exception when others then
  raise warning 'the push retry backstop was not registered (%)', sqlerrm;
  return 'failed';
 end;
end $$;

-- Nothing here is a client surface: the trigger is the only caller of the
-- dispatcher, and registration is the migration's and an operator's. Repeated
-- here so the internal-only contract does not depend on the applied file's ACLs
-- being intact; both directions are idempotent.
revoke all on function public.findback_push_dispatch_now() from public, anon, authenticated;
grant execute on function public.findback_push_dispatch_now() to service_role;
revoke all on function public.findback_push_dispatch_on_notification() from public, anon, authenticated;
revoke all on function public.findback_schedule_push_dispatch() from public, anon, authenticated, service_role;

do $$ begin
 raise notice 'push dispatch backstop registration: %', public.findback_schedule_push_dispatch();
end $$;

commit;
