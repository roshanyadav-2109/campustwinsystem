-- The shared Google sign-in (campustwin.org/auth/google/callback) signs people
-- in to every Eternity product. Besides school records and HR employees, it lets
-- in anyone whose login has been given access to an Eternity product: a member
-- of an organisation, or someone on a product team (Finance accountants and
-- viewers, the HR team). This returns that login's id, or null.
-- Server only: the service role calls it; nobody else can.

begin;

create or replace function core.login_for_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(p_email))
    and (exists (select 1 from core.membership m where m.user_id = u.id and m.status = 'active')
      or exists (select 1 from fin.team t where t.user_id = u.id)
      or exists (select 1 from hr.team t where t.user_id = u.id))
  limit 1
$$;

revoke all on function core.login_for_email(text) from public, anon, authenticated;
grant execute on function core.login_for_email(text) to service_role;

commit;
