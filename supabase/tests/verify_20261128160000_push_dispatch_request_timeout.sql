-- Catalog readback only: this file sends no request and leaves nothing behind.
-- Run after the migration chain in a disposable database.
--
-- 20261128160000_push_dispatch_request_timeout.sql must leave the write-time
-- dispatcher enqueueing the same authenticated call with a 15 s timeout, so a
-- cold-started Edge Function is not aborted mid-transfer: the request reaches
-- the device when the notification row is written instead of waiting for the
-- per-minute backstop. The surface stays SECURITY DEFINER with a locked
-- search_path and unreachable for the client roles.
begin;
do $$
declare
  v_body text;
  v_definer boolean;
  v_config text[];
begin
  select p.prosrc, p.prosecdef, p.proconfig
    into v_body, v_definer, v_config
  from pg_proc p
  where p.oid = 'public.findback_push_dispatch_now()'::regprocedure;
  if v_body is null then
    raise exception 'public.findback_push_dispatch_now() does not exist';
  end if;
  if not v_definer then
    raise exception 'the push dispatcher is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from unnest(coalesce(v_config, '{}'::text[])) as c
                 where c like 'search_path=%' and c like '%public%' and c like '%pg_temp%') then
    raise exception 'the push dispatcher does not lock search_path';
  end if;

  -- The credential and the authenticated header are unchanged: a body that
  -- stopped reading Vault would make every write-time call an unauthorized
  -- no-op, and the function rejects it silently.
  if v_body not like '%vault.decrypted_secrets%'
     or v_body not like '%''push_dispatch_secret''%' then
    raise exception 'the push dispatcher does not read its secret from Vault';
  end if;
  if v_body not like '%net.http_post%'
     or v_body not like '%x-findback-dispatch-secret%'
     or v_body not like '%functions/v1/push-dispatch%' then
    raise exception 'the push dispatcher does not enqueue the authenticated dispatch request';
  end if;

  -- Both preconditions still return instead of raising: an insert must not fail
  -- while the extensions or the Vault view are absent.
  if v_body not like '%to_regclass(''vault.decrypted_secrets'')%'
     or v_body not like '%to_regprocedure(''net.http_post(text,jsonb,jsonb,jsonb,integer)'')%' then
    raise exception 'the push dispatcher lost a precondition guard';
  end if;

  -- The measured defect: a 5 s client timeout aborts a cold start. Matching on
  -- the assignment, not the bare digits, because '15000' itself contains '5000'.
  if v_body !~ 'timeout_milliseconds[[:space:]]*:=[[:space:]]*15000' then
    raise exception 'the push dispatcher does not enqueue the dispatch with the 15 s timeout';
  end if;
  if v_body ~ 'timeout_milliseconds[[:space:]]*:=[[:space:]]*5000([^0-9]|$)' then
    raise exception 'the push dispatcher still enqueues the dispatch with the 5 s timeout a cold start aborts';
  end if;

  -- No client role may call the dispatcher, before or after this replacement.
  if has_function_privilege('anon','public.findback_push_dispatch_now()','EXECUTE')
     or has_function_privilege('authenticated','public.findback_push_dispatch_now()','EXECUTE') then
    raise exception 'a client role can reach the push dispatcher';
  end if;
end $$;
select 'PASS push dispatch enqueues with a 15 s timeout and stays internal-only' as result;
rollback;
