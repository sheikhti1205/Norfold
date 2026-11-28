-- Write-time push dispatch for engagement notifications.
--
-- WHAT WAS LATE. A comment, like, dislike, mention or status row reached a device
-- only when something called the `push-dispatch` Edge Function, and the only
-- caller was a GitHub Actions cron. GitHub throttles that `*/10` schedule for
-- this repository to roughly three runs a day (measured at 02:2x, ~10-11:00 and
-- ~19:5x UTC), so a notification written at 03:00 could wait seven or eight hours
-- for its FCM message.
--
-- WHAT THIS ADDS. The database calls the dispatcher the moment a row is inserted
-- into `public.notifications`: an AFTER INSERT trigger enqueues an HTTP POST
-- through pg_net, whose durable queue is delivered asynchronously, so the insert
-- never waits on the network or on FCM. A pg_cron job every minute calls the same
-- function as a retry backstop for whatever one drain missed — a transient FCM
-- failure, a row written while the Edge Function was being redeployed, or a
-- request enqueued while pg_net was still installing. This file installs both
-- extensions when the platform offers them; a cluster without them warns and
-- still applies, because they are deployment capability, not schema.
--
-- WHY A TRIGGER RATHER THAN TIGHTER POLLING. Seconds-level polling is a request
-- per interval forever, and the scheduler that was supposed to poll cannot be
-- made to run at that rate here; the insert is the only event that actually knows
-- a notification exists. `push-dispatch` ignores the request body and drains every
-- pending row, so a nudge costs one drain and carries no ids: it is not one send
-- per row.
--
-- FAILURE CONTAINMENT, STATED EXACTLY. Push must never be able to fail a write:
--   * the dispatcher returns without error while its Vault secret is absent, so a
--     deploy that has not yet seeded the secret cannot break notification inserts;
--   * the trigger calls it inside `exception when others then null`, so a missing
--     extension, an unreachable function or an unreadable secret degrades to the
--     cron backstop instead of rejecting the row.
--
-- The secret is never written here: `supabase db push` runs with `--skip-vault`,
-- and the deploy workflow seeds Vault `push_dispatch_secret` with psql. The
-- function host below is public configuration, not a credential.
--
-- LIVE-PENDING. supabase/tests/verify_20261128140000_push_dispatch_write_time.sql
-- proves from the catalog only that the trigger is AFTER INSERT, per row and
-- enabled; that the dispatcher is SECURITY DEFINER and unreachable for
-- anon/authenticated; that its body reads the credential from Vault; that the call
-- is exception-wrapped; and that the backstop is the `* * * * *` job (or reports
-- itself unavailable on a cluster without pg_cron). It sends no request. The
-- end-to-end proof is an inserted row reaching a device on the deployed project.
begin;

-- The dispatcher. It re-reads the secret on every call, so a Vault rotation takes
-- effect on the next notification instead of waiting for a redeploy. Every
-- precondition that is absent returns instead of raising: an insert must not fail
-- because push infrastructure is not deployed yet.
create or replace function public.findback_push_dispatch_now()
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_secret text;
begin
 if to_regclass('vault.decrypted_secrets') is null then return; end if;
 if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1'
  into v_secret using 'push_dispatch_secret';
 if coalesce(btrim(v_secret),'')='' then return; end if;
 -- Fire and forget: pg_net stores the request and a background worker sends it.
 -- The function authenticates on the header; the body is ignored, so it names the
 -- caller only to make an operator's pg_net inspection readable.
 perform net.http_post(
  url := 'https://nfjhpigbsyyoaaktfaev.supabase.co/functions/v1/push-dispatch',
  headers := jsonb_build_object('content-type','application/json',
   'x-findback-dispatch-secret',btrim(v_secret)),
  body := jsonb_build_object('source','write-time-trigger'),
  timeout_milliseconds := 5000);
end $$;

-- The trigger body. A failure here must not abort the insert that created the
-- notification, so the call is wrapped; the per-minute job retries the work.
create or replace function public.findback_push_dispatch_on_notification()
returns trigger language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
 begin
  perform public.findback_push_dispatch_now();
 exception when others then
  null;
 end;
 return null;
end $$;

-- Registration. Idempotent and inert on a cluster without the extensions: it
-- returns 'unavailable' and registers nothing, exactly like the media-worker
-- scheduler, so the disposable chain harness applies this file unchanged and the
-- live project registers itself. The extension is created in the schema Supabase
-- documents (`pg_catalog` for pg_cron, `extensions` for pg_net) and the grants the
-- hosted platform normally applies are repeated, because the dispatcher runs as
-- this definer and needs both schemas.
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
 -- Re-registering by name is the only supported re-run path: a changed cadence
 -- must not accumulate duplicate jobs or silently keep the old one.
 begin
  delete from cron.job where jobname = 'findback_push_dispatch';
  perform cron.schedule('findback_push_dispatch','* * * * *',
   'select public.findback_push_dispatch_now()');
  return 'scheduled';
 exception when others then
  raise warning 'the push retry backstop was not registered (%)', sqlerrm;
  return 'failed';
 end;
end $$;

-- Nothing here is a client surface: the trigger is the only caller of the
-- dispatcher, and registration is the migration's and an operator's. This matches
-- the neighbouring internal triggers, which are revoked from the client roles.
revoke all on function public.findback_push_dispatch_now() from public, anon, authenticated;
grant execute on function public.findback_push_dispatch_now() to service_role;
revoke all on function public.findback_push_dispatch_on_notification() from public, anon, authenticated;
revoke all on function public.findback_schedule_push_dispatch() from public, anon, authenticated, service_role;

drop trigger if exists trg_findback_push_dispatch_notification on public.notifications;
create trigger trg_findback_push_dispatch_notification
 after insert on public.notifications
 for each row execute function public.findback_push_dispatch_on_notification();

do $$ begin
 raise notice 'push dispatch registration: %', public.findback_schedule_push_dispatch();
end $$;

commit;
