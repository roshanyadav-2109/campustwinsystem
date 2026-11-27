-- Roles and positions, slice 1 (docs/campustwin/higher-ed-plan.md): titles
-- each institution names itself (Vice Chancellor, Dean, Director, HoD, CoE...),
-- each with an access type from a fixed list and a scope level; positions held
-- by staff (several per person, dated, acting); faculties/schools grouping
-- departments. Shown on screen and on documents; access does not change yet.
begin;
create table if not exists public.academic_unit (
  id        bigint generated always as identity primary key,
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  code      text not null check (char_length(code) between 1 and 12),
  name      text not null check (char_length(name) between 2 and 100),
  kind      text not null default 'faculty' check (kind in ('faculty', 'school', 'institute', 'centre')),
  unique (school_id, code)
);
alter table public.department add column if not exists unit_id bigint references public.academic_unit(id) on delete set null;

create table if not exists public.position_title (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  access_type text not null check (access_type in ('governing', 'head', 'deputy_head', 'registrar', 'finance_head', 'student_affairs',
                 'exams_head', 'exams_deputy', 'exams_staff', 'confidential', 'evaluator', 'moderator', 'exam_centre', 'revaluation',
                 'dean', 'dept_head', 'programme_coord', 'faculty', 'advisor', 'office_staff', 'service')),
  scope_level text not null check (scope_level in ('university', 'campus', 'faculty', 'department', 'programme')),
  active      boolean not null default true,
  sort        int not null default 100
);
create unique index if not exists uq_position_title_name on public.position_title (school_id, lower(name));

create table if not exists public.staff_position (
  id            bigint generated always as identity primary key,
  school_id     bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  staff_id      bigint not null references public.staff(id) on delete cascade,
  title_id      bigint not null references public.position_title(id) on delete restrict,
  unit_id       bigint references public.academic_unit(id) on delete restrict,
  department_id bigint references public.department(id) on delete restrict,
  programme_id  bigint references public.programme(id) on delete restrict,
  starts_on     date not null default (now() at time zone 'Asia/Kolkata')::date,
  ends_on       date,
  acting        boolean not null default false,
  created_at    timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists idx_staff_position_staff on public.staff_position (staff_id);

create table if not exists public.position_log (
  id        bigint generated always as identity primary key,
  school_id bigint not null references public.school(id) on delete cascade,
  at        timestamptz not null default now(),
  by_staff  bigint references public.staff(id) on delete set null,
  action    text not null check (action in ('assigned', 'ended')),
  staff_id  bigint references public.staff(id) on delete set null,
  detail    text not null
);

do $$ declare t text; begin
  foreach t in array array['academic_unit', 'position_title', 'staff_position', 'position_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('drop policy if exists p_read on public.%I', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- titles, units and positions are shown on documents and approvals: everyone signed in reads them
create policy p_read on public.academic_unit for select to authenticated using (true);
create policy p_read on public.position_title for select to authenticated using (true);
create policy p_read on public.staff_position for select to authenticated using (true);
create policy p_read on public.position_log for select to authenticated using ((select app.is_admin_scope()));
drop policy if exists p_write on public.academic_unit;
create policy p_write on public.academic_unit for all to authenticated using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));
drop policy if exists p_write on public.position_title;
create policy p_write on public.position_title for all to authenticated using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));
revoke truncate, trigger, references on public.academic_unit, public.position_title from authenticated;
grant select, insert, update, delete on public.academic_unit, public.position_title to authenticated;
revoke insert, update, delete, truncate, trigger, references on public.staff_position, public.position_log from authenticated;
grant select on public.staff_position, public.position_log to authenticated;

-- the place a position applies to, in words
create or replace function public.position_place(p public.staff_position) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.name from public.academic_unit u where u.id = p.unit_id),
                  (select d.name from public.department d where d.id = p.department_id),
                  (select g.name from public.programme g where g.id = p.programme_id));
$$;

-- assign a position (office or head); the scope must match the title's level
create or replace function public.assign_position(p_staff bigint, p_title bigint, p_unit bigint, p_department bigint, p_programme bigint,
                                                  p_from date, p_to date, p_acting boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); t public.position_title; v_id bigint; p public.staff_position;
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the head can assign positions'; end if;
  select * into t from public.position_title where id = p_title and school_id = v_school and active;
  if t.id is null then raise exception 'Unknown title'; end if;
  if not exists (select 1 from public.staff where id = p_staff and school_id = v_school) then raise exception 'Unknown staff member'; end if;
  if (t.scope_level = 'faculty') <> (p_unit is not null) or (t.scope_level = 'department') <> (p_department is not null) or (t.scope_level = 'programme') <> (p_programme is not null) then
    raise exception 'Choose the % this position is for', t.scope_level;
  end if;
  if (p_unit is not null and not exists (select 1 from public.academic_unit where id = p_unit and school_id = v_school))
     or (p_department is not null and not exists (select 1 from public.department where id = p_department and school_id = v_school))
     or (p_programme is not null and not exists (select 1 from public.programme where id = p_programme and school_id = v_school)) then
    raise exception 'Unknown place';
  end if;
  if exists (select 1 from public.staff_position x where x.staff_id = p_staff and x.title_id = p_title and coalesce(x.unit_id, 0) = coalesce(p_unit, 0)
               and coalesce(x.department_id, 0) = coalesce(p_department, 0) and coalesce(x.programme_id, 0) = coalesce(p_programme, 0)
               and (x.ends_on is null or x.ends_on >= coalesce(p_from, current_date))) then
    raise exception 'This person already holds this position';
  end if;
  insert into public.staff_position (school_id, staff_id, title_id, unit_id, department_id, programme_id, starts_on, ends_on, acting)
  values (v_school, p_staff, p_title, p_unit, p_department, p_programme, coalesce(p_from, (now() at time zone 'Asia/Kolkata')::date), p_to, coalesce(p_acting, false))
  returning * into p;
  insert into public.position_log (school_id, by_staff, action, staff_id, detail)
  values (v_school, app.my_staff_id(), 'assigned', p_staff, case when p.acting then 'Acting ' else '' end || t.name || coalesce(', ' || public.position_place(p), '') || ' from ' || p.starts_on);
  return p.id;
end $$;
revoke all on function public.assign_position(bigint, bigint, bigint, bigint, bigint, date, date, boolean) from public, anon;
grant execute on function public.assign_position(bigint, bigint, bigint, bigint, bigint, date, date, boolean) to authenticated;

create or replace function public.end_position(p_id bigint, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.staff_position; v_on date := coalesce(p_on, (now() at time zone 'Asia/Kolkata')::date);
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the head can end positions'; end if;
  update public.staff_position set ends_on = greatest(v_on, starts_on) where id = p_id and school_id = public.current_school_id() and (ends_on is null or ends_on > v_on) returning * into p;
  if p.id is null then raise exception 'This position has already ended'; end if;
  insert into public.position_log (school_id, by_staff, action, staff_id, detail)
  select p.school_id, app.my_staff_id(), 'ended', p.staff_id, t.name || coalesce(', ' || public.position_place(p), '') || ' on ' || p.ends_on from public.position_title t where t.id = p.title_id;
end $$;
revoke all on function public.end_position(bigint, date) from public, anon;
grant execute on function public.end_position(bigint, date) to authenticated;

-- current titles of a staff member ("Dean, Faculty of Engineering; Director, ...")
create or replace function public.staff_titles(p_staff bigint) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(case when p.acting then 'Acting ' else '' end || t.name || coalesce(', ' || public.position_place(p), ''), '; ' order by t.sort, t.name)
  from public.staff_position p join public.position_title t on t.id = p.title_id
  where p.staff_id = p_staff and p.school_id = public.current_school_id()
    and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date);
$$;
grant execute on function public.staff_titles(bigint) to authenticated;

-- who signs for an access type at this campus now (title and name), for documents
create or replace function public.signatory(p_type text) returns table (title text, name text)
language sql stable security definer set search_path = '' as $$
  select t.name, s.full_name from public.staff_position p join public.position_title t on t.id = p.title_id join public.staff s on s.id = p.staff_id
  where p.school_id = public.current_school_id() and t.access_type = p_type and t.scope_level in ('campus', 'university')
    and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date and (p.ends_on is null or p.ends_on >= (now() at time zone 'Asia/Kolkata')::date)
  order by p.acting, p.starts_on limit 1;
$$;
grant execute on function public.signatory(text) to authenticated;

-- the usual titles for a college or a university campus (every one can be renamed)
create or replace function public.seed_position_titles(p_school bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_uni boolean; n int;
begin
  if exists (select 1 from public.position_title where school_id = p_school) then return 0; end if;
  select university_id is not null into v_uni from public.school where id = p_school;
  insert into public.position_title (school_id, name, access_type, scope_level, sort)
  select p_school, x.name, x.t, x.l, x.s from (values
    ('Chancellor', 'governing', 'university', 1, true), ('Pro-Chancellor', 'governing', 'university', 2, true),
    ('Vice Chancellor', 'head', 'university', 3, true), ('Pro Vice Chancellor', 'deputy_head', 'university', 4, true),
    ('Registrar', 'registrar', 'university', 5, true), ('Controller of Examinations', 'exams_head', 'university', 6, true),
    ('Finance Officer', 'finance_head', 'university', 7, true), ('Dean (Academics)', 'dean', 'campus', 8, true),
    ('Dean of Students', 'student_affairs', 'campus', 9, true), ('Director', 'head', 'campus', 10, true),
    ('Principal', 'head', 'campus', 10, false), ('Vice Principal', 'deputy_head', 'campus', 11, false),
    ('Controller of Examinations', 'exams_head', 'campus', 12, false), ('Office Superintendent', 'registrar', 'campus', 13, false),
    ('Accounts Officer', 'finance_head', 'campus', 14, false),
    ('Dean', 'dean', 'faculty', 20, null), ('Director (Institute)', 'dean', 'faculty', 21, true),
    ('Head of Department', 'dept_head', 'department', 30, null), ('Director (Department)', 'dept_head', 'department', 31, null),
    ('Programme Coordinator', 'programme_coord', 'programme', 40, null),
    ('Deputy Controller of Examinations', 'exams_deputy', 'campus', 50, null), ('Exam Section Superintendent', 'exams_staff', 'campus', 51, null),
    ('Confidential Officer', 'confidential', 'campus', 52, null), ('Examiner', 'evaluator', 'campus', 53, null),
    ('Moderator', 'moderator', 'campus', 54, null), ('Chief Superintendent (Exams)', 'exam_centre', 'campus', 55, null),
    ('Invigilator', 'exam_centre', 'campus', 56, null), ('Revaluation Officer', 'revaluation', 'campus', 57, null),
    ('Professor', 'faculty', 'department', 60, null), ('Associate Professor', 'faculty', 'department', 61, null),
    ('Assistant Professor', 'faculty', 'department', 62, null), ('Class Advisor', 'advisor', 'campus', 63, null),
    ('Mentor', 'advisor', 'campus', 64, null), ('Office Assistant', 'office_staff', 'campus', 70, null),
    ('Admissions Officer', 'office_staff', 'campus', 71, null), ('Warden', 'service', 'campus', 80, null),
    ('Librarian', 'service', 'campus', 81, null)
  ) x(name, t, l, s, uni)
  where x.uni is null or x.uni = v_uni;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.seed_position_titles(bigint) from public, anon, authenticated;

create or replace function public.add_usual_titles() returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the head can do this'; end if;
  if not public.is_higher_ed(public.current_school_id()) then raise exception 'For colleges and universities'; end if;
  return public.seed_position_titles(public.current_school_id());
end $$;
grant execute on function public.add_usual_titles() to authenticated;

-- colleges and university campuses start with the usual titles
select public.seed_position_titles(s.id) from public.school s where public.is_higher_ed(s.id);
commit;
notify pgrst, 'reload schema';
