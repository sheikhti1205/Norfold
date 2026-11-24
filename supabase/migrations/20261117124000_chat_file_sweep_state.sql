-- Audit 2026-11-17: the chat-file sweep restarted at the bucket root on
-- every capped run.
--
-- `sweepChatFiles` stopped after 500 objects, 200 folders or 80 seconds, but
-- kept no position. With more than 500 objects the next run re-listed the same
-- first page forever, so the tail was never reached. The worker now persists a
-- page-level cursor between runs and clears it when a full cycle completes.
--
-- The row is a single fixed key (`id = true`), written only by the service-role
-- worker through this RPC. No client role can read or write it.
begin;

create table if not exists public.chat_file_sweep_state (
  id boolean primary key default true check (id),
  queue jsonb not null default '[]'::jsonb check (jsonb_typeof(queue) = 'array'),
  folder text,
  page_offset integer not null default 0 check (page_offset >= 0),
  updated_at timestamptz not null default now()
);

alter table public.chat_file_sweep_state enable row level security;
revoke all on public.chat_file_sweep_state from public, anon, authenticated;

comment on table public.chat_file_sweep_state
  is $cmt$One-row resume cursor for the cleanup-chat-files worker: remaining folder queue, current folder and page offset. Service-role only; cleared when a full bucket cycle completes.$cmt$;

create or replace function public.findback_chat_file_sweep_state(
  p_action text,
  p_queue jsonb default '[]'::jsonb,
  p_folder text default null,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.chat_file_sweep_state;
begin
  if p_action = 'read' then
    select * into v_row from public.chat_file_sweep_state where id;
    if not found then
      return null;
    end if;
    return jsonb_build_object('queue', v_row.queue, 'folder', v_row.folder, 'offset', v_row.page_offset);
  end if;

  if p_action = 'clear' then
    delete from public.chat_file_sweep_state where id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action <> 'save' then
    raise exception 'invalid sweep action' using errcode = '22023';
  end if;

  if p_queue is null
     or jsonb_typeof(p_queue) <> 'array'
     or jsonb_array_length(p_queue) > 1000
     or exists (
       select 1 from jsonb_array_elements(p_queue) element
       where jsonb_typeof(element) <> 'string'
          or length(element #>> '{}') > 1024
          or left(element #>> '{}', 1) = '/'
     ) then
    raise exception 'invalid sweep queue' using errcode = '22023';
  end if;
  if p_folder is not null
     and (length(p_folder) > 1024 or left(p_folder, 1) = '/' or position(chr(0) in p_folder) > 0) then
    raise exception 'invalid sweep folder' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000000 then
    raise exception 'invalid sweep offset' using errcode = '22023';
  end if;

  insert into public.chat_file_sweep_state(id, queue, folder, page_offset, updated_at)
  values (true, p_queue, p_folder, p_offset, now())
  on conflict (id) do update
    set queue = excluded.queue,
        folder = excluded.folder,
        page_offset = excluded.page_offset,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.findback_chat_file_sweep_state(text, jsonb, text, integer)
  from public, anon, authenticated;
grant execute on function public.findback_chat_file_sweep_state(text, jsonb, text, integer)
  to service_role;

-- A rerun of an unapplied migration must not keep a cursor that points into a
-- bucket the operator is about to re-check from scratch.
delete from public.chat_file_sweep_state where id;

commit;
