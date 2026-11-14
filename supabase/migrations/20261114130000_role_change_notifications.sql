-- Role and permission changes now produce a consumer notification.
--
-- Owner brief 2026-11-14: "Admin invites/removals/permission changes must
-- generate notifications." The append-only admin log already records who
-- changed what; this migration is the other half — the affected account is
-- told in its own inbox.
--
-- DESIGN
--   * A row-level trigger on public.user_roles covers grant, role change and
--     revoke. It is the write path every RPC (grant, invitation acceptance,
--     revoke, bootstrap) already goes through, so no RPC body is duplicated
--     here and a future write path cannot silently skip the inbox.
--   * A row-level trigger on public.user_role_capabilities covers a pure
--     permission edit. It writes ONE row per transaction: the notification
--     table is checked for a ROLE row created at the same transaction time
--     (`now()` is constant inside a transaction), which also collapses the
--     delete-then-insert sequence of a capability replacement.
--   * A capability delete during a revoke is skipped when the account no
--     longer holds a role; the role trigger already wrote the final sentence.
--   * actor_id is NULL on purpose. The inbox tells the account what its access
--     is now; it does not need to name the admin who made the change, and the
--     consumer surface would otherwise expose staff identities.
--
-- COPY is consequence-only, like the MODERATION outcome copy:
--   "You now have the moderator role." / "Your staff access has ended." /
--   "Your staff permissions were updated."
-- No capability ids, role ids or audit vocabulary reach the inbox.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('LIKE', 'DISLIKE', 'COMMENT', 'MENTION', 'STATUS', 'REACTION', 'MODERATION', 'ROLE'));

create or replace function public.findback_notify_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id text;
  v_actor text;
  v_role text;
  v_preview text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_actor := old.granted_by;
    v_preview := 'Your staff access has ended.';
  else
    v_user_id := new.user_id;
    v_actor := new.granted_by;
    v_role := lower(new.role);
    v_preview := case tg_op
      when 'UPDATE' then format('Your role changed to %s.', v_role)
      else format('You now have the %s role.', v_role)
    end;
  end if;

  -- Never tell an admin about their own bootstrap action.
  if v_user_id is null or v_user_id = v_actor then
    return null;
  end if;

  insert into public.notifications
    (id, user_id, actor_id, type, post_id, comment_id, preview, read, created_at, deleted_at, reaction_kind)
  values
    (gen_random_uuid()::text, v_user_id, null, 'ROLE', null, null, left(v_preview, 200), 0, v_now, null, null);

  return null;
end;
$$;

revoke all on function public.findback_notify_role_assignment() from public, anon, authenticated;

drop trigger if exists user_roles_notify_assignment on public.user_roles;
create trigger user_roles_notify_assignment
  after insert or update or delete on public.user_roles
  for each row execute function public.findback_notify_role_assignment();

create or replace function public.findback_notify_capability_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id text;
  v_actor text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_actor := old.granted_by;
  else
    v_user_id := new.user_id;
    v_actor := new.granted_by;
  end if;

  if v_user_id is null or v_user_id = v_actor then
    return null;
  end if;

  -- A revoke removes the role first, then its capability rows. There is no
  -- role left to describe, and the role trigger already wrote the sentence.
  if not exists (select 1 from public.user_roles r where r.user_id = v_user_id) then
    return null;
  end if;

  -- One inbox row per transaction: now() is constant in a transaction, so the
  -- delete-then-insert of a capability replacement matches the row written by
  -- the first trigger. A role row written in the same transaction also wins —
  -- "You now have the moderator role" already explains the new permissions.
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_user_id
      and n.type = 'ROLE'
      and n.created_at = v_now
  ) then
    return null;
  end if;

  insert into public.notifications
    (id, user_id, actor_id, type, post_id, comment_id, preview, read, created_at, deleted_at, reaction_kind)
  values
    (gen_random_uuid()::text, v_user_id, null, 'ROLE', null, null,
     'Your staff permissions were updated.', 0, v_now, null, null);

  return null;
end;
$$;

revoke all on function public.findback_notify_capability_change() from public, anon, authenticated;

drop trigger if exists user_role_capabilities_notify_change on public.user_role_capabilities;
create trigger user_role_capabilities_notify_change
  after insert or delete on public.user_role_capabilities
  for each row execute function public.findback_notify_capability_change();

comment on function public.findback_notify_role_assignment() is
  'Consumer inbox sentence for a role grant, change or revoke. Actor is intentionally NULL.';
comment on function public.findback_notify_capability_change() is
  'Consumer inbox sentence for a capability change, collapsed to one row per transaction.';
