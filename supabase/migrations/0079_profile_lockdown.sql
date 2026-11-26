-- SECURITY: a signed-in person could change any column of their own profile
-- row (role, staff_id, school_id ...) and so make themselves the school office.
-- Logins are created and changed only by trusted server code (service role).
-- Signed-in people may change just their language and, for university central
-- admins, which campus they are working in (guarded by its own trigger).
begin;
revoke insert, update, delete on public.profile from authenticated, anon;
grant update (locale, active_campus_id) on public.profile to authenticated;
drop policy if exists profile_admin_write on public.profile;
commit;
