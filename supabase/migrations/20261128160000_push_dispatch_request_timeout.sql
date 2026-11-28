-- Write-time push dispatch request timeout.
--
-- WHAT WAS MEASURED. `public.findback_push_dispatch_now()` enqueued its HTTP
-- call with `timeout_milliseconds := 5000`. On the deployed project a
-- `push-dispatch` Edge Function cold start takes about five seconds, and that
-- 5 s timeout aborts the transfer before the function answers. Two adjacent
-- rows of `net._http_response` show it directly:
--
--   status_code NULL, timed_out TRUE    (cold start)
--   status_code 200,  timed_out FALSE   (warm invocation)
--
-- An aborted write-time dispatch leaves the notification to the per-minute
-- `pg_cron` backstop instead of delivering it when the row is written, which is
-- the latency this path exists to remove. The timeout is raised to 15000.
--
-- WHAT THIS DOES NOT CHANGE. `net.http_post` only enqueues the request and
-- returns immediately, so the timeout governs the pg_net background worker's
-- request, never the insert. The trigger, its exception wrapper, the
-- registration helper, the Vault read and the authenticated header are all
-- untouched: only the timeout value differs from the applied definition.
--
-- LIVE-PENDING.
-- supabase/tests/verify_20261128160000_push_dispatch_request_timeout.sql reads
-- the catalog back: the dispatcher still exists as SECURITY DEFINER with a
-- locked search_path, still posts the Vault secret to `functions/v1/push-dispatch`
-- with the 15 s timeout, and stays unreachable for the client roles.
begin;

-- The dispatcher, re-created with a timeout that survives a cold start. Every
-- precondition that is absent still returns instead of raising: an insert must
-- not fail because push infrastructure is not deployed yet.
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
  timeout_milliseconds := 15000);
end $$;

-- Nothing here is a client surface: the trigger is the only caller of the
-- dispatcher. Repeated in the file that replaces the function so the
-- internal-only contract does not depend on the applied file's ACLs.
revoke all on function public.findback_push_dispatch_now() from public, anon, authenticated;
grant execute on function public.findback_push_dispatch_now() to service_role;

commit;
