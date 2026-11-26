-- One person, several institutions.
--
-- person_membership: each institution a login belongs to, with the role and
-- the record there (a staff, parent or student record). A teacher at two
-- schools, a parent with children at two schools, a student who moved on to a
-- college all keep one login with one membership per institution.
--
-- Which institution a request is for comes from the website it was made on:
-- the app sends the institution's address (x-campustwin-school header) with
-- every database call, and current_membership() honours it only when the
-- person is a member there. Without the header (background jobs, realtime),
-- or for an institution they do not belong to, the last-used institution in
-- `profile` is used, exactly as before. Two open tabs on two institutions
-- therefore never write into each other.
--
-- `profile` stays the "last used" row and keeps working for everything that
-- inserts it directly (console, sign-in, tests): a trigger copies it into
-- person_membership. University central admins keep their own campus
-- switching (university_id / active_campus_id) unchanged.
-- The functions replaced here are kept in supabase/rollback/0078_rollback.sql.
begin;

create table if not exists public.person_membership (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  school_id   bigint not null references public.school(id) on delete cascade,
  role        text not null check (role in ('staff', 'guardian', 'student')),
  staff_id    bigint references public.staff(id) on delete cascade,
  guardian_id bigint references public.guardian(id) on delete cascade,
  student_id  bigint references public.student(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, school_id, role),
  check ((role = 'staff') = (staff_id is not null) and (role = 'guardian') = (guardian_id is not null) and (role = 'student') = (student_id is not null))
);
create unique index if not exists uq_membership_staff on public.person_membership (staff_id) where staff_id is not null;
create unique index if not exists uq_membership_guardian on public.person_membership (guardian_id) where guardian_id is not null;
create unique index if not exists uq_membership_student on public.person_membership (student_id) where student_id is not null;
create index if not exists idx_membership_user on public.person_membership (user_id);

-- Keep memberships in step with the profile row (sign-in, console, tests all
-- write the profile). A record can belong to one login only: if it moves to
-- another login, the old membership goes.
create or replace function public.profile_to_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.school_id is null or new.role::text not in ('staff', 'guardian', 'student') then return new; end if;
  if (new.role::text = 'staff' and new.staff_id is null) or (new.role::text = 'guardian' and new.guardian_id is null) or (new.role::text = 'student' and new.student_id is null) then return new; end if;
  delete from public.person_membership m where m.user_id <> new.id and (
    (new.role::text = 'staff' and m.staff_id = new.staff_id) or (new.role::text = 'guardian' and m.guardian_id = new.guardian_id) or (new.role::text = 'student' and m.student_id = new.student_id));
  insert into public.person_membership (user_id, school_id, role, staff_id, guardian_id, student_id)
  values (new.id, new.school_id, new.role::text,
          case when new.role::text = 'staff' then new.staff_id end,
          case when new.role::text = 'guardian' then new.guardian_id end,
          case when new.role::text = 'student' then new.student_id end)
  on conflict (user_id, school_id, role) do update
    set staff_id = excluded.staff_id, guardian_id = excluded.guardian_id, student_id = excluded.student_id;
  return new;
end $$;
drop trigger if exists trg_profile_to_membership on public.profile;
create trigger trg_profile_to_membership after insert or update of school_id, role, staff_id, guardian_id, student_id on public.profile
  for each row execute function public.profile_to_membership();

-- Everyone who can sign in today becomes a member of their institution.
insert into public.person_membership (user_id, school_id, role, staff_id, guardian_id, student_id)
select p.id, p.school_id, p.role::text,
       case when p.role::text = 'staff' then p.staff_id end,
       case when p.role::text = 'guardian' then p.guardian_id end,
       case when p.role::text = 'student' then p.student_id end
from public.profile p
where p.school_id is not null and p.role::text in ('staff', 'guardian', 'student')
  and ((p.role::text = 'staff' and p.staff_id is not null) or (p.role::text = 'guardian' and p.guardian_id is not null) or (p.role::text = 'student' and p.student_id is not null))
on conflict do nothing;

-- The institution the request is for, when the person belongs to it.
create or replace function public.requested_school_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select s.id from public.school s
  where s.slug = nullif(current_setting('request.headers', true)::json ->> 'x-campustwin-school', '')
    and exists (select 1 from public.person_membership m where m.user_id = auth.uid() and m.school_id = s.id);
$$;

-- The membership this request acts as: the requested institution (staff
-- before parent before student, as at sign-in), else the last-used one.
create or replace function public.current_membership() returns setof public.person_membership
language sql stable security definer set search_path = '' as $$
  with p as (select school_id, role::text as role from public.profile where id = auth.uid()),
       target as (select coalesce(public.requested_school_id(), (select school_id from p)) as school_id)
  select m.* from public.person_membership m
  where m.user_id = auth.uid() and m.school_id = (select school_id from target)
  order by case
    when public.requested_school_id() is null and m.role = (select role from p) then 0
    when m.role = 'staff' then 1 when m.role = 'guardian' then 2 else 3 end
  limit 1;
$$;

create or replace function public.current_school_id() returns bigint
language sql stable security definer set search_path = 'public' as $$
  select case
    -- university central admins: their own campus switch, unchanged
    when p.university_id is not null then coalesce(p.active_campus_id, p.school_id)
    else coalesce((select m.school_id from public.current_membership() m), coalesce(p.active_campus_id, p.school_id))
  end
  from public.profile p where p.id = auth.uid();
$$;

create or replace function app.my_staff_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.staff_id from public.current_membership() m),
                  (select p.staff_id from public.profile p where p.id = auth.uid() and p.university_id is not null));
$$;

create or replace function app.my_guardian_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select m.guardian_id from public.current_membership() m;
$$;

create or replace function app.my_role() returns public.profile_role
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.role::public.profile_role from public.current_membership() m), (select p.role from public.profile p where p.id = auth.uid()));
$$;

create or replace function app.my_staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s where s.id = app.my_staff_id();
$$;

create or replace function app.my_owned_students() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select m.student_id from public.current_membership() m where m.role = 'student'
  union
  select gs.student_id from public.current_membership() m
    join public.guardian_student gs on gs.guardian_id = m.guardian_id
  where m.role = 'guardian';
$$;

create or replace function app.owns_student(p_student bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.my_owned_students() s where s = p_student);
$$;

-- People see their own memberships (to switch); the office and principal see
-- who belongs to their institution.
alter table public.person_membership enable row level security;
drop policy if exists membership_own on public.person_membership;
create policy membership_own on public.person_membership for select to authenticated
  using (user_id = auth.uid() or (school_id = public.current_school_id() and (select app.is_admin_scope())));
grant select on public.person_membership to authenticated;
grant all on public.person_membership to service_role;

-- Names and addresses of the institutions a person belongs to, for the switcher.
create or replace function public.my_institutions() returns table (school_id bigint, name text, slug text, role text, current boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.slug, m.role, s.id = public.current_school_id()
  from public.person_membership m join public.school s on s.id = m.school_id
  where m.user_id = auth.uid() and s.status <> 'deleted'
  order by s.name, m.role;
$$;
grant execute on function public.my_institutions() to authenticated;

commit;
