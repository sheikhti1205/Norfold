-- Chat send-time transport (DISPOSABLE synthetic probe; this transaction ROLLBACKs).
--
-- Run against a disposable PostgreSQL/Supabase test database after applying
-- 20261109020000_norfold_chat_client_time.sql. No production rows or accounts.
--
-- Covers: the nullable column, the sender instant surviving into the mailbox
-- projection (the same envelope conversation sync reuses), the older-row
-- fallback to sent_at, the credibility bound, and replay idempotency when a
-- retry carries a different instant.
begin;

do $$ begin
  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'chat_messages'
       and column_name = 'client_sent_at'
  ), 'chat_messages carries the sender composition instant';
end $$;

insert into public.users(id,username,email,phone,email_verified,created_at,updated_at) values
 ('00000000-0000-4000-9912-000000000001','time_9912_a','time_9912_a@example.invalid','+8801991200001',1,now(),now()),
 ('00000000-0000-4000-9912-000000000002','time_9912_b','time_9912_b@example.invalid','+8801991200002',1,now(),now());
insert into public.chat_conversations(id,user_a,user_b,state,initiated_by,receipt_connection_epoch) values
 ('time-9912-connected','00000000-0000-4000-9912-000000000001','00000000-0000-4000-9912-000000000002',
  'CONNECTED','00000000-0000-4000-9912-000000000001','time-9912-epoch');
select set_config('request.jwt.claim.sub','00000000-0000-4000-9912-000000000001',true);
select public.findback_register_chat_device('00000000-0000-4000-9912-000000000010','web');

do $$
declare v_epoch text; v_claim bigint; v_old bigint; v_first text; v_retry text;
 v_rows jsonb; v_started timestamptz:=clock_timestamp(); v_server_ms bigint;
begin
 select public.findback_chat_relationship_epoch(c) into v_epoch from public.chat_conversations c
  where c.id='time-9912-connected';
 v_claim:=round(extract(epoch from v_started)*1000)::bigint - 5000;

 v_first:=public.findback_chat_send_internal('time-9912-connected','first','00000000-0000-4000-9912-000000000101',
  'TEXT',v_epoch,jsonb_build_object('createdAt',v_claim::text));
 -- A retry with a different instant resolves to the accepted id and never
 -- rewrites the stored composition time.
 v_retry:=public.findback_chat_send_internal('time-9912-connected','first','00000000-0000-4000-9912-000000000101',
  'TEXT',v_epoch,jsonb_build_object('createdAt',(v_claim-1000)::text));
 if v_first is distinct from '00000000-0000-4000-9912-000000000101'
  or v_retry is distinct from v_first then
  raise exception 'client-time retry was not idempotent: % / %',v_first,v_retry;
 end if;
 -- A claim outside one week back is not credible; the server sent_at wins.
 perform public.findback_chat_send_internal('time-9912-connected','old','00000000-0000-4000-9912-000000000102',
  'TEXT',v_epoch,jsonb_build_object('createdAt','1000'));

 select jsonb_object_agg(e#>>'{event,message,id}',(e#>>'{event,message,createdAt}')::bigint) into v_rows
  from public.findback_fetch_chat_mailbox('00000000-0000-4000-9912-000000000010') e
  where e#>>'{event,message,id}' in ('00000000-0000-4000-9912-000000000101',
   '00000000-0000-4000-9912-000000000102');
 if (v_rows->>'00000000-0000-4000-9912-000000000101')::bigint is distinct from v_claim then
  raise exception 'mailbox dropped the sender composition instant: % vs %',
   v_rows->>'00000000-0000-4000-9912-000000000101',v_claim;
 end if;
 v_server_ms:=round(extract(epoch from clock_timestamp())*1000)::bigint;
 v_old:=(v_rows->>'00000000-0000-4000-9912-000000000102')::bigint;
 if v_old < v_server_ms - 60000 or v_old > v_server_ms + 60000 then
  raise exception 'implausible client time was not replaced by sent_at: %',v_old;
 end if;
end $$;

select 'PASS sender composition instant survives into the shared mailbox projection' as result;
rollback;
