-- Owner audit 2026-11-15 (P1): the contact-rule table is RPC-only.
--
-- WHAT WENT WRONG. Supabase's default privileges hand a newly created table in
-- `public` to `anon` and `authenticated` before the migration body runs. The
-- 20261112160000 migration then granted SELECT/INSERT/UPDATE to `authenticated`
-- without first revoking, so both roles kept the default set: SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES. The owner-only RLS policies
-- constrain ordinary row work, but TRUNCATE is not governed by row-level
-- security, so the grant was broader than any policy the table declares.
--
-- WHY REVOKING IS SAFE. Nothing reads this table directly: the client calls
-- findback_get_contact_rules() and findback_set_contact_rules(), both
-- SECURITY DEFINER and executable only by `authenticated`. Revoking the table
-- grants removes an unreachable surface instead of adding a new dependency.
--
-- The two owner policies go with it. With every direct grant gone they can
-- never be evaluated, and the ALL policy merely duplicated the SELECT policy's
-- owner predicate. service_role keeps its own grants and remains the operator
-- path.
begin;

revoke all on public.account_contact_rules from public, anon, authenticated;
drop policy if exists account_contact_rules_owner_read on public.account_contact_rules;
drop policy if exists account_contact_rules_owner_write on public.account_contact_rules;

comment on table public.account_contact_rules is
  'Per-account contact rules. RPC-only: findback_get_contact_rules() and findback_set_contact_rules(text, text, text) are the only client paths; direct table grants and the owner RLS policies were removed on 2026-11-15 because the Supabase default grants leaked TRUNCATE and DELETE.';

commit;
