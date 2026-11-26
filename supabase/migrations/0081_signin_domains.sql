-- Sign-in by institution email domain, and one login per email.
-- * school.allowed_email_domains: when set (usually colleges and universities
--   that give everyone an institutional address), only emails at these domains
--   can sign in to that institution. Empty = any email (most schools).
-- * auth_user_for_email(): the existing login for an email, so a person who
--   joins a second institution keeps their one login instead of getting another.
alter table public.school add column if not exists allowed_email_domains text[];

create or replace function public.auth_user_for_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) order by u.created_at limit 1;
$$;
revoke all on function public.auth_user_for_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_for_email(text) to service_role;
