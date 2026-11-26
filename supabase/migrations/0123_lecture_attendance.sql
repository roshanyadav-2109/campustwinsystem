-- Higher education, step 5: lecture attendance and the 75% rule.
-- A teacher marks one lecture (section, subject, date, period) for the
-- students registered in that course. Each student's percentage per course is
-- worked out for the current semester; below the institution's minimum (75%
-- unless changed) is a shortage; the office can condone a shortage with a
-- reason. Lecture rows use attendance_record with period and subject set, so
-- the daily register and absence alerts (period empty) are not affected.
begin;
alter table public.school add column if not exists attendance_minimum numeric(5,2) not null default 75 check (attendance_minimum between 0 and 100);

create table if not exists public.attendance_condonation (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  semester_id bigint not null references public.semester(id) on delete cascade,
  student_id  bigint not null references public.student(id) on delete cascade,
  subject_id  bigint not null references public.subject(id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 200),
  approved_by bigint references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (semester_id, student_id, subject_id)
);
alter table public.attendance_condonation enable row level security;
drop policy if exists tenant_isolation on public.attendance_condonation;
create policy tenant_isolation on public.attendance_condonation as restrictive for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists ac_read on public.attendance_condonation;
create policy ac_read on public.attendance_condonation for select to authenticated using ((select app.my_staff_id()) is not null or app.owns_student(student_id));
drop policy if exists ac_write on public.attendance_condonation;
create policy ac_write on public.attendance_condonation for all to authenticated using ((select app.is_office())) with check ((select app.is_office()));
revoke all on public.attendance_condonation from anon;
grant select, insert, update, delete on public.attendance_condonation to authenticated;
revoke truncate, trigger, references on public.attendance_condonation from authenticated;
grant all on public.attendance_condonation to service_role;

-- mark one lecture: the teacher of that section and subject, the class teacher or the office
create or replace function public.mark_lecture(p_section bigint, p_subject bigint, p_date date, p_period smallint, p_absent bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_year bigint; n int;
begin
  select academic_year_id into v_year from public.semester where school_id = v_school and is_current;
  if v_year is null then raise exception 'No current semester'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school)
     or not exists (select 1 from public.subject where id = p_subject and school_id = v_school) then raise exception 'Unknown section or subject'; end if;
  if not (coalesce(app.is_office(), false) or app.ct_of_section(p_section, v_year)
          or exists (select 1 from public.teacher_allotment ta where ta.staff_id = app.my_staff_id() and ta.section_id = p_section and ta.subject_id = p_subject and ta.academic_year_id = v_year)) then
    raise exception 'Only the teacher of this course can mark it';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'A lecture cannot be marked for a future day'; end if;
  delete from public.attendance_record where section_id = p_section and subject_id = p_subject and on_date = p_date and period = p_period;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, marked_by, school_id)
  select e.student_id, p_section, v_year, p_date, p_period, p_subject,
         (case when e.student_id = any(coalesce(p_absent, '{}')) then 'absent' else 'present' end)::public.attendance_status, app.my_staff_id(), v_school
  from public.student_enrollment e where e.section_id = p_section and e.academic_year_id = v_year and e.status = 'active';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_lecture(bigint, bigint, date, smallint, bigint[]) from public, anon;
grant execute on function public.mark_lecture(bigint, bigint, date, smallint, bigint[]) to authenticated;

-- percentage per student and subject in the current semester (one section, or the caller's own record)
create or replace function public.course_attendance(p_section bigint default null, p_student bigint default null)
returns table (student_id bigint, student_name text, subject_id bigint, subject text, held int, attended int, percent numeric, short boolean, condoned boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.semester; v_min numeric;
begin
  select * into s from public.semester where school_id = v_school and is_current;
  if s.id is null then return; end if;
  if p_student is not null then
    if not (coalesce(app.is_admin_scope(), false) or app.owns_student(p_student) or app.my_staff_id() is not null) then raise exception 'Not allowed'; end if;
  elsif not (coalesce(app.is_admin_scope(), false) or app.ct_of_section(p_section, s.academic_year_id) or app.teaches_section(p_section, s.academic_year_id)) then
    raise exception 'Not allowed';
  end if;
  select attendance_minimum into v_min from public.school where id = v_school;
  return query
  select a.student_id, st.full_name, a.subject_id, sb.name,
    count(*)::int, count(*) filter (where a.status in ('present', 'late'))::int,
    round(100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*), 1),
    100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*) < v_min,
    exists (select 1 from public.attendance_condonation c where c.semester_id = s.id and c.student_id = a.student_id and c.subject_id = a.subject_id)
  from public.attendance_record a
  join public.student st on st.id = a.student_id join public.subject sb on sb.id = a.subject_id
  where a.school_id = v_school and a.period is not null and a.subject_id is not null
    and a.on_date between s.starts_on and s.ends_on
    and (p_section is null or a.section_id = p_section) and (p_student is null or a.student_id = p_student)
  group by a.student_id, st.full_name, a.subject_id, sb.name
  order by st.full_name, sb.name;
end $$;
grant execute on function public.course_attendance(bigint, bigint) to authenticated;
commit;
