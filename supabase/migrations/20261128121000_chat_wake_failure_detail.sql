-- Failure detail for external wakes, kept in the database because the Edge
-- runtime captures no `console` output for these functions: the wake device row
-- is the only surface where an FCM answer survives. Without it a wake can sit at
-- PENDING with `attempts` climbing and no cause recorded anywhere.
--
-- `last_status` is FCM's HTTP status; `last_error` is the bounded error text
-- (whitespace-collapsed by the caller) or, when no request reached FCM, a short
-- reason (`oauth`, `eligibility`, `network`, `malformed`). No message content,
-- device token or access token is ever written here.
--
-- ADDITIVE ONLY: two nullable diagnostic columns and one replaced RPC. Rows that
-- already exist keep null diagnostics until their next attempt; the column types,
-- RLS and the `chat_external_wakes` table are untouched.
begin;
alter table public.chat_external_wake_devices
 add column if not exists last_status integer,
 add column if not exists last_error text;

-- The signature grows two optional trailing arguments, so the old four-argument
-- function is dropped first: Postgres would otherwise keep both overloads and a
-- four-argument call would be ambiguous. The state machine, the attempt ceiling,
-- the lease release and the SENT/SUPPRESSED/INVALID/RETRY mapping are unchanged.
drop function if exists public.findback_finish_chat_external_wake(text,text,text,text);
create function public.findback_finish_chat_external_wake(p_wake_id text,p_device_id text,p_claim_token text,p_result text,
 p_status integer default null,p_error text default null)
returns boolean language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 if p_result is null or p_result not in ('SENT','SUPPRESSED','INVALID','RETRY') then raise exception 'Invalid disposition' using errcode='22023'; end if;
 update public.chat_external_wake_devices d set
  state=case when p_result='RETRY' and d.attempts>=5 then 'EXHAUSTED' when p_result='RETRY' then 'PENDING' else p_result end,
  next_attempt_at=case when p_result='RETRY' then clock_timestamp()+make_interval(secs=>least(3600,30*(2^greatest(d.attempts-1,0))::integer)) else d.next_attempt_at end,
  claim_token=null,lease_until=null,
  last_status=case when p_result='SENT' then null else p_status end,
  last_error=case when p_result='SENT' then null else left(regexp_replace(p_error,'\s+',' ','g'),240) end
 where d.wake_id=p_wake_id and d.device_id=p_device_id and d.state='CLAIMED'
  and d.claim_token=p_claim_token and d.lease_until>clock_timestamp();
 get diagnostics n=row_count; return n=1;
end $$;
revoke all on function public.findback_finish_chat_external_wake(text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.findback_finish_chat_external_wake(text,text,text,text,integer,text) to service_role;
commit;
