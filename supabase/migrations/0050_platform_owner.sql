-- 0050: Platform owner allowlist for the company console (console.campustwin.org).
-- An owner is identified by email. The console runs server-side with the
-- service-role (admin) client and is gated by a check against this table, so the
-- console can manage every institution while nobody else can reach it. Owners
-- have no school profile; they sign in via Google and are let through only if
-- their email is listed here (see the Google callback owner branch).
create table if not exists public.platform_owner (
  email      text primary key,
  note       text,
  created_at timestamptz default now()
);

-- Lock it down: no access for ordinary authenticated users. The server reads it
-- with the service-role key (which bypasses RLS); enabling RLS with no policy
-- denies everyone else.
alter table public.platform_owner enable row level security;

select 'platform_owner created' as status;
