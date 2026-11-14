-- A renamed device keeps its name across enrollments.
--
-- Enrollment runs again for every new Auth session, and the commit upsert used
-- to overwrite device_name with whatever the client sent. A reader who renamed
-- a device then lost that name at the next sign-in. The stored name now wins,
-- except for the placeholders older builds sent ("Browser", "Android device")
-- and rows that never had a name at all; those take the specific default the
-- current build sends ("Chrome on Windows", "Pixel 7").
--
-- Body and fences are unchanged from 20261104010000_norfold_device_authority.sql;
-- only the device_name branch of the upsert differs.
--
-- Local milestone WIP: applies with the rest of the device-authority chain.
-- Verification pointer: supabase/tests/verify_norfold_device_authority.sql.
begin;

create or replace function public.findback_device_enrollment_commit(p_uid text,p_session uuid,p_challenge uuid)
returns jsonb language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare c public.chat_device_challenges%rowtype; d public.chat_devices%rowtype; g uuid:=gen_random_uuid();
 n bigint:=floor(extract(epoch from clock_timestamp())*1000);
begin
  perform public.findback_device_lock_internal(p_uid,true);
  n:=floor(extract(epoch from clock_timestamp())*1000);
 select * into c from public.chat_device_challenges where id=p_challenge and user_id=p_uid and session_id=p_session for update;
 if not found or c.consumed_at is not null or c.expires_ms<=n then raise exception 'Device proof unavailable' using errcode='42501'; end if;
 perform public.findback_device_context_internal(p_uid,p_session,c.device_id,true);
 select * into d from public.chat_devices where user_id=p_uid and device_id=c.device_id for update;
 if found and (d.revoked_at is not null or (d.public_key is not null and d.public_key<>c.public_key)) then
  raise exception 'Device unavailable' using errcode='42501'; end if;
 if d.id is null and (select count(*) from public.chat_devices where user_id=p_uid and revoked_at is null)>=20 then
  raise exception 'Too many devices' using errcode='54000'; end if;
 -- Same-session retries/heartbeats preserve generation. Rebind atomically fences
 -- every historical old session; key itself is never overwritten or rotated.
 if d.auth_session_id=p_session then g:=d.enrollment_generation;
 else
  update public.chat_device_sessions set revoked_at=coalesce(revoked_at,clock_timestamp())
   where user_id=p_uid and device_id=c.device_id and session_id<>p_session;
  delete from public.device_tokens where user_id=p_uid and installation_id=c.device_id;
 end if;
 insert into public.chat_devices(user_id,device_id,device_name,platform,public_key,auth_session_id,enrollment_generation)
 values(p_uid,c.device_id,c.device_name,c.platform,c.public_key,p_session,g)
 on conflict(user_id,device_id) do update set
  -- A stored label is the reader's or a real default; only an old placeholder
  -- is replaced. btrim covers labels stored before names were required.
  device_name=case
   when chat_devices.device_name is null or btrim(chat_devices.device_name)=''
    or chat_devices.device_name in('Browser','Android device','Device')
   then excluded.device_name else chat_devices.device_name end,
  platform=excluded.platform,
  public_key=coalesce(chat_devices.public_key,excluded.public_key),auth_session_id=excluded.auth_session_id,
  enrollment_generation=excluded.enrollment_generation,last_seen_at=clock_timestamp();
 insert into public.chat_device_sessions(session_id,user_id,device_id,generation) values(p_session,p_uid,c.device_id,g)
 on conflict(session_id) do nothing;
 update public.chat_device_challenges set consumed_at=clock_timestamp() where id=c.id;
 return public.findback_device_context_internal(p_uid,p_session,c.device_id);
end $$;

commit;
