-- 0049: University -> campus hierarchy (Model 1 + active-campus scoping).
--
-- A campus is its own tenant `school` row whose university_id points at its
-- `university`. A standalone school has university_id = null (unchanged).
--
-- A central university admin is a profile with university_id set. Instead of
-- seeing all campuses merged together, the admin has an ACTIVE campus: every
-- existing per-school page auto-scopes to it because current_school_id() returns
-- the active campus. Switching campus = updating active_campus_id. A cross-campus
-- roll-up is provided by the university_overview() RPC. This reuses the entire
-- existing app unchanged while keeping strict per-campus isolation.
--
-- Idempotent. Built/tested on staging first; NOT applied to live.

-- 1. University umbrella (brand / billing group / default modules for campuses).
create table if not exists public.university (
  id            bigserial primary key,
  name          text not null,
  slug          text not null unique,
  short_name    text,
  logo_url      text,
  primary_color text default '#0F6CBD',
  plan          text default 'standard',
  status        text default 'active' check (status in ('active','suspended')),
  modules       jsonb default '{"twin":false,"fees":true,"library":true,"homework":true,"admissions":true,"hr":true,"transport":true}'::jsonb,
  created_at    timestamptz default now()
);

-- 2. Links. active_campus_id = the campus a central admin is currently working in.
alter table public.school  add column if not exists university_id   bigint references public.university(id);
alter table public.profile add column if not exists university_id   bigint references public.university(id);
alter table public.profile add column if not exists active_campus_id bigint references public.school(id);
create index if not exists idx_school_university  on public.school(university_id);
create index if not exists idx_profile_university on public.profile(university_id);

-- 3. Caller's university (null for ordinary campus users).
create or replace function public.current_university_id()
returns bigint language sql stable security definer set search_path = public as $$
  select university_id from public.profile where id = auth.uid()
$$;

-- 4. The campus school_ids the caller's university owns (SECURITY DEFINER so it
--    bypasses `school` RLS). Empty for ordinary users.
create or replace function public.university_school_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select s.id from public.school s
  where s.university_id is not null
    and s.university_id = (select p.university_id from public.profile p where p.id = auth.uid())
$$;

-- 4b. The university id a campus user belongs to (via their home school). Used by
--     the university table's read policy so campus users can read their brand row.
create or replace function public.university_school_ids_university()
returns setof bigint language sql stable security definer set search_path = public as $$
  select s.university_id from public.school s
  where s.id = (select p.school_id from public.profile p where p.id = auth.uid())
    and s.university_id is not null
$$;

-- 5. Effective tenant: a central admin's chosen active campus, else their own
--    school. Ordinary users are unaffected (active_campus_id is null). This makes
--    every existing per-school page and SECURITY DEFINER function scope to the
--    active campus automatically.
create or replace function public.current_school_id()
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(active_campus_id, school_id) from public.profile where id = auth.uid()
$$;

-- 6. Re-assert the tenant_isolation policy as PLAIN (school_id = current_school_id()).
--    Scoping is handled by current_school_id() above, so no widening is needed.
do $$
declare r record; col text; pred text;
begin
  for r in
    select tablename from pg_policies
    where schemaname = 'public' and policyname = 'tenant_isolation'
  loop
    if r.tablename = 'school' then col := 'id'; else col := 'school_id'; end if;
    pred := format('%1$I = public.current_school_id()', col);
    execute format('drop policy if exists tenant_isolation on public.%I', r.tablename);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      r.tablename, pred, pred
    );
  end loop;
end $$;

-- 7. Guard: a central admin may only set active_campus_id to a campus of their own
--    university (or null). Prevents hopping into an unrelated tenant.
create or replace function public.profile_active_campus_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active_campus_id is not null then
    if new.university_id is null
       or not exists (
         select 1 from public.school s
         where s.id = new.active_campus_id and s.university_id = new.university_id
       ) then
      raise exception 'active_campus_id must be a campus of the profile''s university';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_profile_active_campus on public.profile;
create trigger trg_profile_active_campus before insert or update on public.profile
  for each row execute function public.profile_active_campus_guard();

-- 8. RLS for the university table.
alter table public.university enable row level security;
drop policy if exists university_select on public.university;
drop policy if exists university_write  on public.university;
create policy university_select on public.university for select to authenticated
  using (
    id = public.current_university_id()
    or id in (select public.university_school_ids_university())
  );
create policy university_write on public.university for all to authenticated
  using (id = public.current_university_id())
  with check (id = public.current_university_id());

-- 9. Cross-campus roll-up for central admins: per-campus headline stats for the
--    caller's university (SECURITY DEFINER, scoped to their university only).
create or replace function public.university_overview()
returns table(campus_id bigint, campus_name text, slug text, status text, students bigint, staff bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.slug, s.status,
    (select count(*) from public.student st where st.school_id = s.id),
    (select count(*) from public.staff  sf where sf.school_id = s.id)
  from public.school s
  where s.university_id is not null
    and s.university_id = public.current_university_id()
  order by s.name
$$;

select 'university+campus hierarchy (active-campus model) applied' as status;
