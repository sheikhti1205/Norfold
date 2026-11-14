-- Authoritative "does this account have a password?" answer for the signed-in
-- reader.
--
-- Identities and user_metadata are not proof: an OAuth account can keep only a
-- google identity after a password is set, and user_metadata is writable by the
-- client. auth.users.encrypted_password is the only source that proves a
-- password exists. This SECURITY DEFINER function exposes one boolean for
-- auth.uid() and nothing else; anon cannot execute it.
--
-- Additive only. Verification: select public.has_account_password(); as an
-- authenticated user, and confirm anon receives permission denied.

begin;

create or replace function public.has_account_password()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = auth.uid()
       and u.encrypted_password is not null
       and length(u.encrypted_password) > 0
  );
$$;

revoke all on function public.has_account_password() from public, anon;
grant execute on function public.has_account_password() to authenticated;

comment on function public.has_account_password() is
  'True when the signed-in account has a password hash. SECURITY DEFINER; authenticated only.';

notify pgrst, 'reload schema';

commit;
