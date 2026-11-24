-- 0049: University -> campus hierarchy (Model 1: each campus is its own tenant
-- `school` row, grouped under a `university`). A standalone school has
-- university_id = null (unchanged behaviour). A campus is a `school` row whose
-- university_id points at its university; its subdomain is the school slug
-- (e.g. srmktr.campustwin.org). A central university admin is a profile with
-- university_id set, which grants read/write across ALL campuses of that
-- university on top of the existing per-campus isolation.
-- Idempotent. Built/tested on staging first.

-- 1. The university (umbrella brand / billing group).
create table if not exists public.university (
  id            bigserial primary key,
  name          text not null,
  slug          text not null unique,
  short_name    text,
  logo_url      text,
  primary_color text default '#0F6CBD',
  plan          text default 'standard',
  status        text default 'active' check (status in ('active','suspended')),
  -- default module set applied to new campuses of this university
  modules       jsonb default '{"twin":false,"fees":true,"library":true,"homework":true,"admissions":true,"hr":true,"transport":true}'::jsonb,
  created_at    timestamptz default now()
);

-- 2. Link columns.
alter table public.school  add column if not exists university_id bigint references public.university(id);
alter table public.profile add column if not exists university_id bigint references public.university(id);
create index if not exists idx_school_university  on public.school(university_id);
create index if not exists idx_profile_university on public.profile(university_id);

-- 3. Caller's university (null for ordinary campus users).
create or replace function public.current_university_id()
returns bigint language sql stable security definer set search_path = public as $$
  select university_id from public.profile where id = auth.uid()
$$;

-- 4. The set of campus school_ids the caller may reach through their university.
--    SECURITY DEFINER so it bypasses `school`'s own RLS. Empty for ordinary
--    users (their profile.university_id is null).
create or replace function public.university_school_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select s.id
  from public.school s
  where s.university_id is not null
    and s.university_id = (select p.university_id from public.profile p where p.id = auth.uid())
$$;

-- 5. Widen the tenant isolation RESTRICTIVE policy on every tenant table to also
--    allow the caller's own-university campuses. Ordinary users are unaffected
--    (university_school_ids() is empty for them). The `school` table keys on
--    `id`; all others on `school_id`.
do $$
declare r record; col text; pred text;
begin
  for r in
    select tablename from pg_policies
    where schemaname = 'public' and policyname = 'tenant_isolation'
  loop
    if r.tablename = 'school' then col := 'id'; else col := 'school_id'; end if;
    pred := format(
      '%1$I = public.current_school_id() or %1$I in (select public.university_school_ids())',
      col
    );
    execute format('drop policy if exists tenant_isolation on public.%I', r.tablename);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      r.tablename, pred, pred
    );
  end loop;
end $$;

-- 6. RLS for the new university table.
alter table public.university enable row level security;
drop policy if exists university_select on public.university;
drop policy if exists university_write  on public.university;
-- Read: central admins see their university; campus users see the university
-- their campus belongs to (for shared branding).
create policy university_select on public.university for select to authenticated
  using (
    id = public.current_university_id()
    or id = (select s.university_id from public.school s where s.id = public.current_school_id())
  );
-- Write: central admins manage their own university row. (service_role bypasses
-- RLS for the backend/console and getBrand's branding lookup.)
create policy university_write on public.university for all to authenticated
  using (id = public.current_university_id())
  with check (id = public.current_university_id());

select 'university+campus hierarchy applied' as status;
