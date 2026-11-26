-- Higher education, step 1: academic structure (colleges and university
-- campuses only). Department -> programme (with its regulation: duration,
-- total credits) -> courses placed in semesters with credits and type.
-- The existing class / section stay as the year batch and division, so fees,
-- timetable and attendance keep working; class.programme_id + year_no link
-- them, and subject.course_id links a teaching subject to its course.
begin;
create or replace function public.is_higher_ed(p_school bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.institution_type = 'college' or s.university_id is not null from public.school s where s.id = p_school), false);
$$;
grant execute on function public.is_higher_ed(bigint) to authenticated;

create table if not exists public.department (
  id        bigint generated always as identity primary key,
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  code      text not null check (char_length(code) between 1 and 12),
  name      text not null check (char_length(name) between 1 and 80),
  unique (school_id, code)
);
create table if not exists public.programme (
  id            bigint generated always as identity primary key,
  school_id     bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  department_id bigint references public.department(id) on delete set null,
  code          text not null check (char_length(code) between 1 and 16),
  name          text not null check (char_length(name) between 1 and 100),
  level         text not null default 'ug' check (level in ('diploma', 'ug', 'pg', 'phd')),
  regulation    text not null default 'R2024' check (char_length(regulation) <= 20),
  years         smallint not null check (years between 1 and 6),
  semesters     smallint not null check (semesters between 1 and 12),
  total_credits numeric(6,1),
  unique (school_id, code, regulation)
);
create table if not exists public.course (
  id            bigint generated always as identity primary key,
  school_id     bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  department_id bigint references public.department(id) on delete set null,
  code          text not null check (char_length(code) between 1 and 16),
  name          text not null check (char_length(name) between 1 and 120),
  kind          text not null default 'core' check (kind in ('core', 'elective', 'lab', 'aec', 'sec', 'vac', 'project')),
  lecture       smallint not null default 3 check (lecture between 0 and 10),
  tutorial      smallint not null default 0 check (tutorial between 0 and 10),
  practical     smallint not null default 0 check (practical between 0 and 20),
  credits       numeric(4,1) not null check (credits between 0 and 30),
  unique (school_id, code)
);
create table if not exists public.programme_course (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  programme_id bigint not null references public.programme(id) on delete cascade,
  course_id    bigint not null references public.course(id) on delete cascade,
  semester_no  smallint not null check (semester_no between 1 and 12),
  elective_group text check (elective_group is null or char_length(elective_group) <= 30),
  unique (programme_id, course_id)
);
create table if not exists public.semester (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  kind             text not null check (kind in ('odd', 'even', 'summer')),
  starts_on        date not null,
  ends_on          date not null,
  is_current       boolean not null default false,
  unique (academic_year_id, kind),
  check (ends_on > starts_on)
);
create unique index if not exists uq_semester_current on public.semester (school_id) where is_current;

alter table public.class add column if not exists programme_id bigint references public.programme(id) on delete set null;
alter table public.class add column if not exists year_no smallint check (year_no is null or year_no between 1 and 6);
alter table public.subject add column if not exists course_id bigint references public.course(id) on delete set null;

do $$ declare t text; begin
  foreach t in array array['department', 'programme', 'course', 'programme_course', 'semester'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('drop policy if exists he_read on public.%I', t);
    execute format('create policy he_read on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists he_write on public.%I', t);
    execute format('create policy he_write on public.%I for all to authenticated using ((select app.is_office())) with check ((select app.is_office()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- only colleges and university campuses; references stay inside the institution
create or replace function public.higher_ed_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_higher_ed(new.school_id) then raise exception 'Programmes and courses are for colleges and universities'; end if;
  if tg_table_name in ('programme', 'course') then
    if new.department_id is not null and not exists (select 1 from public.department d where d.id = new.department_id and d.school_id = new.school_id) then
      raise exception 'That department is not at this institution';
    end if;
  end if;
  if tg_table_name = 'programme_course' then
    if not exists (select 1 from public.programme p where p.id = new.programme_id and p.school_id = new.school_id and new.semester_no <= p.semesters)
       or not exists (select 1 from public.course c where c.id = new.course_id and c.school_id = new.school_id) then
      raise exception 'That course or semester does not fit this programme';
    end if;
  end if;
  if tg_table_name = 'semester' then
    if not exists (select 1 from public.academic_year y where y.id = new.academic_year_id and y.school_id = new.school_id) then raise exception 'That year is not at this institution'; end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['department', 'programme', 'course', 'programme_course', 'semester'] loop
    execute format('drop trigger if exists trg_higher_ed_guard on public.%I', t);
    execute format('create trigger trg_higher_ed_guard before insert or update on public.%I for each row execute function public.higher_ed_guard()', t);
  end loop;
end $$;

-- credits per semester of a programme (for the structure screen and checks)
create or replace function public.programme_credits(p_programme bigint)
returns table (semester_no smallint, courses int, credits numeric)
language sql stable security definer set search_path = '' as $$
  select pc.semester_no, count(*)::int, sum(c.credits) filter (where pc.elective_group is null) + coalesce(max(c.credits) filter (where pc.elective_group is not null), 0)
  from public.programme_course pc join public.course c on c.id = pc.course_id
  where pc.programme_id = p_programme and pc.school_id = public.current_school_id()
  group by pc.semester_no order by 1;
$$;
grant execute on function public.programme_credits(bigint) to authenticated;
commit;
