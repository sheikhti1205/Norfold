-- R3: pressing Settings opens a floating account panel
-- that carries the account-level rules which had no home.
--
-- Nothing here invents a product concept: messaging already has an admission
-- ledger and a block table, so "who may start a conversation with me" and "who
-- may send me a connection request" are stored facts an admission can read, not
-- a label in a settings screen.
--
-- Scope: one table, its owner-only policies, and two definer functions. Values
-- are closed sets so the client cannot store a fourth option and the admission
-- path can switch on them without parsing free text.

begin;

create table if not exists public.account_contact_rules (
  user_id text primary key references public.users(id) on delete cascade,
  message_from text not null default 'ANYONE'
    check (message_from in ('ANYONE', 'CONNECTED', 'NOBODY')),
  connect_from text not null default 'ANYONE'
    check (connect_from in ('ANYONE', 'CONNECTED', 'NOBODY')),
  show_contact text not null default 'CONNECTED'
    check (show_contact in ('ANYONE', 'CONNECTED', 'NOBODY')),
  updated_at timestamptz not null default now()
);

alter table public.account_contact_rules enable row level security;

drop policy if exists account_contact_rules_owner_read on public.account_contact_rules;
create policy account_contact_rules_owner_read on public.account_contact_rules
  for select to authenticated using ((select auth.uid())::text = user_id);

drop policy if exists account_contact_rules_owner_write on public.account_contact_rules;
create policy account_contact_rules_owner_write on public.account_contact_rules
  for all to authenticated using ((select auth.uid())::text = user_id)
  with check ((select auth.uid())::text = user_id);

grant select, insert, update on public.account_contact_rules to authenticated;

create or replace function public.findback_get_contact_rules()
returns table (message_from text, connect_from text, show_contact text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  return query
    select coalesce(r.message_from, 'ANYONE'),
           coalesce(r.connect_from, 'ANYONE'),
           coalesce(r.show_contact, 'CONNECTED')
      from (select 1) as one
      left join public.account_contact_rules r on r.user_id = v_uid;
end;
$$;

create or replace function public.findback_set_contact_rules(
  p_message_from text, p_connect_from text, p_show_contact text)
returns table (message_from text, connect_from text, show_contact text)
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_uid text := auth.uid()::text;
  v_allowed text[] := array['ANYONE', 'CONNECTED', 'NOBODY'];
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_message_from is null or p_message_from <> all(v_allowed)
     or p_connect_from is null or p_connect_from <> all(v_allowed)
     or p_show_contact is null or p_show_contact <> all(v_allowed) then
    raise exception 'Unsupported contact rule' using errcode = '22023';
  end if;
  insert into public.account_contact_rules (user_id, message_from, connect_from, show_contact, updated_at)
  values (v_uid, p_message_from, p_connect_from, p_show_contact, now())
  on conflict (user_id) do update
    set message_from = excluded.message_from,
        connect_from = excluded.connect_from,
        show_contact = excluded.show_contact,
        updated_at = now();
  return query select r.message_from, r.connect_from, r.show_contact
    from public.account_contact_rules r where r.user_id = v_uid;
end;
$$;

revoke all on function public.findback_get_contact_rules() from public, anon;
revoke all on function public.findback_set_contact_rules(text, text, text) from public, anon;
grant execute on function public.findback_get_contact_rules() to authenticated;
grant execute on function public.findback_set_contact_rules(text, text, text) to authenticated;

comment on table public.account_contact_rules is
  'Owner-set contact rules: who may message, who may send a connection request, and who may see contact details. Read by the settings panel and by messaging admission.';
comment on function public.findback_get_contact_rules() is
  'Returns the caller''s contact rules, defaulting to permissive values when the account has never set any.';
comment on function public.findback_set_contact_rules(text, text, text) is
  'Writes the caller''s contact rules from a closed set and returns the stored row.';

commit;
