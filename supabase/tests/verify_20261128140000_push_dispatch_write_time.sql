-- Catalog readback only: this file sends no request and writes no row. Run after
-- the migration chain in a disposable database.
--
-- 20261128140000_push_dispatch_write_time.sql must leave a notification insert
-- with a write-time dispatch it cannot fail on: an enabled AFTER INSERT row
-- trigger whose body is exception-wrapped, a SECURITY DEFINER dispatcher that
-- reads its credential from Vault at call time, no client-callable path to any of
-- it, and a one-minute retry backstop — or an honest 'unavailable' on a cluster
-- that has no pg_cron, so the chain stays applicable without the platform.
begin;
do $$
declare
  v_trigger text;
  v_dispatch text;
  v_dispatch_definer boolean;
  v_trigger_body text;
  v_trigger_definer boolean;
  v_schedule text;
begin
  -- The trigger exists, is AFTER INSERT FOR EACH ROW on notifications, calls the
  -- wrapper, and is enabled ('O' rather than a disabled 'D'/'R'/'A').
  select pg_get_triggerdef(t.oid) into v_trigger
  from pg_trigger t
  where t.tgrelid = 'public.notifications'::regclass
    and t.tgname = 'trg_findback_push_dispatch_notification'
    and not t.tgisinternal;
  if v_trigger is null then
    raise exception 'write-time push dispatch trigger is missing on public.notifications';
  end if;
  if v_trigger not ilike '%after insert on public.notifications%'
     or v_trigger not ilike '%for each row%'
     or v_trigger not ilike '%execute function public.findback_push_dispatch_on_notification()%' then
    raise exception 'write-time push dispatch trigger has the wrong shape: %', v_trigger;
  end if;
  if (select t.tgenabled from pg_trigger t
      where t.tgrelid = 'public.notifications'::regclass
        and t.tgname = 'trg_findback_push_dispatch_notification') <> 'O' then
    raise exception 'write-time push dispatch trigger is not enabled';
  end if;

  -- The dispatcher is SECURITY DEFINER, resolves its credential from Vault on
  -- every call, and posts the header the function authenticates on. A body that
  -- stopped reading Vault would make every write-time call an unauthorized no-op.
  select p.prosrc, p.prosecdef into v_dispatch, v_dispatch_definer
  from pg_proc p where p.oid = 'public.findback_push_dispatch_now()'::regprocedure;
  if v_dispatch is null then
    raise exception 'public.findback_push_dispatch_now() does not exist';
  end if;
  if not v_dispatch_definer then
    raise exception 'push dispatcher is not SECURITY DEFINER';
  end if;
  if v_dispatch not like '%vault.decrypted_secrets%'
     or v_dispatch not like '%push_dispatch_secret%' then
    raise exception 'push dispatcher does not read its secret from Vault';
  end if;
  if v_dispatch not like '%net.http_post%'
     or v_dispatch not like '%x-findback-dispatch-secret%'
     or v_dispatch not like '%functions/v1/push-dispatch%'
     or v_dispatch not like '%timeout_milliseconds%' then
    raise exception 'push dispatcher does not enqueue the authenticated dispatch request';
  end if;

  -- The trigger body is the exception boundary: without it a push outage could
  -- reject the insert that created the notification.
  select p.prosrc, p.prosecdef into v_trigger_body, v_trigger_definer
  from pg_proc p where p.oid = 'public.findback_push_dispatch_on_notification()'::regprocedure;
  if v_trigger_body is null then
    raise exception 'public.findback_push_dispatch_on_notification() does not exist';
  end if;
  if not v_trigger_definer then
    raise exception 'push dispatch trigger function is not SECURITY DEFINER';
  end if;
  if v_trigger_body not like '%findback_push_dispatch_now()%' then
    raise exception 'trigger does not call the push dispatcher';
  end if;
  if v_trigger_body not like '%exception when others then%' then
    raise exception 'trigger is not exception-wrapped, so a push failure could reject an insert';
  end if;

  -- No client role may call any of it: not the dispatcher, not the trigger body,
  -- not the registration helper.
  if has_function_privilege('anon','public.findback_push_dispatch_now()','EXECUTE')
     or has_function_privilege('authenticated','public.findback_push_dispatch_now()','EXECUTE')
     or has_function_privilege('anon','public.findback_push_dispatch_on_notification()','EXECUTE')
     or has_function_privilege('authenticated','public.findback_push_dispatch_on_notification()','EXECUTE')
     or has_function_privilege('anon','public.findback_schedule_push_dispatch()','EXECUTE')
     or has_function_privilege('authenticated','public.findback_schedule_push_dispatch()','EXECUTE') then
    raise exception 'a client role can reach the push dispatch surface';
  end if;

  -- The backstop cadence is one minute, and it calls the same dispatcher.
  select p.prosrc into v_schedule
  from pg_proc p where p.oid = 'public.findback_schedule_push_dispatch()'::regprocedure;
  if v_schedule is null then
    raise exception 'public.findback_schedule_push_dispatch() does not exist';
  end if;
  if v_schedule not like '%''* * * * *''%' then
    raise exception 'the push retry backstop is not scheduled every minute';
  end if;
  if to_regclass('cron.job') is null then
    -- No extension here: registration must report that and create nothing, the
    -- same inert behaviour the media-worker scheduler proves.
    if public.findback_schedule_push_dispatch() <> 'unavailable' then
      raise exception 'push dispatch registration claimed a schedule without pg_cron';
    end if;
    if exists (select 1 from pg_namespace where nspname = 'cron') then
      raise exception 'push dispatch registration created a cron schema without the extension';
    end if;
  elsif (select count(*) from cron.job
         where jobname = 'findback_push_dispatch'
           and schedule = '* * * * *'
           and command like '%findback_push_dispatch_now%') <> 1 then
    raise exception 'the per-minute push dispatch backstop is not registered exactly once';
  end if;
end $$;
select 'PASS write-time push dispatch is registered, exception-wrapped and internal-only' as result;
rollback;
