-- A public connection count, so the person card and the profile page can say
-- "Connected with N people" with a real number instead of an invented one.
--
-- The count is derived from the one relationship store the product already
-- owns: `chat_conversations` rows in the CONNECTED state. It exposes a number
-- only — never a peer identity, a message, or a direction — so it adds no new
-- read surface over anyone's conversations.
--
-- Exclusions keep the number honest:
--   * a pair with a block in either direction is not a visible connection;
--   * an account inside a deletion fence contributes nothing.
--
-- ADDITIVE ONLY: one SECURITY DEFINER function, no schema change, no data
-- migration. `create or replace` with the same signature keeps a re-run safe.
--
-- Verification: call it as a signed-in member and compare against
-- `select count(*) from chat_conversations where state = 'CONNECTED' and ...`.

create or replace function public.findback_public_connection_count_client(p_user_id text default null)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me text := public.findback_uid();
  v_target text := coalesce(nullif(btrim(coalesce(p_user_id, '')), ''), public.findback_uid());
  v_count integer;
begin
  if v_me is null
    or not exists (select 1 from public.users where id = v_me)
    or exists (select 1 from public.account_deletion_fences where user_id = v_me) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- A missing or malformed target is zero connections, not an error: the card
  -- must never fail because a count could not be attributed.
  if v_target is null or length(v_target) > 100
    or not exists (select 1 from public.users where id = v_target) then
    return 0;
  end if;

  select count(*)::integer
  into v_count
  from public.chat_conversations c
  where c.state = 'CONNECTED'
    and (c.user_a = v_target or c.user_b = v_target)
    and not public.findback_is_blocked_pair(c.user_a, c.user_b)
    and not exists (
      select 1 from public.account_deletion_fences f
      where f.user_id = c.user_a or f.user_id = c.user_b
    );

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.findback_public_connection_count_client(text) from public, anon;
grant execute on function public.findback_public_connection_count_client(text) to authenticated;
