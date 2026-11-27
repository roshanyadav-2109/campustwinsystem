-- Colleges and universities, batch B:
--   1. Supplementary and improvement exam papers are set per course (no class):
--      re-takers sit in different years' classes.
--   2. Faculty workload: weekly hours per teacher from the courses they teach
--      (lecture + tutorial + practical hours), timetabled periods, clashes, and
--      over/under load against the institution's limits.
--   3. Electives across sections: a teacher marks one lecture for everyone
--      registered in the course, whatever their section.
begin;
-- ---------- 1. papers per course ----------
alter table public.exam_paper alter column class_id drop not null;
create unique index if not exists uq_exam_paper_course on public.exam_paper (session_id, subject_id, coalesce(component, '')) where class_id is null;

create or replace function public.exam_paper_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.exam_session; v_clash text;
begin
  if tg_op = 'UPDATE' and (new.session_id <> old.session_id or new.class_id is distinct from old.class_id or new.subject_id <> old.subject_id) then
    raise exception 'A paper cannot move to another exam, class or subject. Remove it and add a new one.';
  end if;
  select * into v_s from public.exam_session where id = new.session_id;
  if v_s.school_id is distinct from new.school_id
     or (new.class_id is not null and not exists (select 1 from public.class c where c.id = new.class_id and c.school_id = new.school_id))
     or not exists (select 1 from public.subject sb where sb.id = new.subject_id and sb.school_id = new.school_id) then
    raise exception 'That record belongs to another institution';
  end if;
  if new.class_id is null then
    -- supplementary and improvement papers are set per course
    if v_s.kind not in ('supplementary', 'improvement') then raise exception 'Choose the class for this paper'; end if;
    select sb.name into v_clash from public.exam_paper p join public.subject sb on sb.id = p.subject_id
     where p.session_id = new.session_id and p.class_id is null and p.exam_date = new.exam_date and p.id is distinct from new.id
       and p.starts_at < new.ends_at and new.starts_at < p.ends_at
       and exists (select 1 from public.supp_registration a join public.supp_registration b on b.student_id = a.student_id and b.session_id = a.session_id
                   join public.subject sa on sa.course_id = a.course_id join public.subject sb2 on sb2.course_id = b.course_id
                   where a.session_id = new.session_id and sa.id = new.subject_id and sb2.id = p.subject_id) limit 1;
    if v_clash is not null then raise exception 'A candidate also sits % at that time', v_clash; end if;
    return new;
  end if;
  -- papers in the same optional group (students take one of them) may share a slot
  select sb.name into v_clash from public.exam_paper p join public.subject sb on sb.id = p.subject_id
   where p.class_id = new.class_id and p.exam_date = new.exam_date and p.id is distinct from new.id
     and p.starts_at < new.ends_at and new.starts_at < p.ends_at
     and not (p.optional_group is not null and p.optional_group = new.optional_group) limit 1;
  if v_clash is not null then raise exception 'This clashes with % for the same class at that time (put optional papers in the same group to allow it)', v_clash; end if;
  if tg_op = 'UPDATE' and new.max_marks < old.max_marks and exists (
       select 1 from public.assessment a join public.mark m on m.assessment_id = a.id where a.exam_paper_id = new.id and m.marks_obtained > new.max_marks) then
    raise exception 'Some marks already entered are above %. Correct them first.', new.max_marks;
  end if;
  return new;
end $$;

-- marks columns follow class papers only (supplementary marks are entered with the registrations)
create or replace function public.exam_paper_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_s public.exam_session; v_sec record; v_name text;
begin
  if new.class_id is null then return null; end if;
  select * into v_s from public.exam_session where id = new.session_id;
  v_name := v_s.name || case when new.component <> 'Theory' then ' (' || new.component || ')' else '' end;
  for v_sec in select id from public.section where class_id = new.class_id and school_id = new.school_id loop
    update public.assessment set name = v_name, term = v_s.term, assessment_type_id = v_s.assessment_type_id,
      assessed_on = new.exam_date, max_marks = new.max_marks
     where exam_paper_id = new.id and section_id = v_sec.id;
    if not found then
      insert into public.assessment (assessment_type_id, subject_id, section_id, academic_year_id, term, name, assessed_on, max_marks, school_id, exam_paper_id, created_by)
      values (v_s.assessment_type_id, new.subject_id, v_sec.id, v_s.academic_year_id, v_s.term, v_name, new.exam_date, new.max_marks, new.school_id, new.id, app.my_staff_id());
    end if;
  end loop;
  return null;
end $$;

-- ---------- 2. workload ----------
alter table public.school add column if not exists workload_max_hours smallint not null default 18 check (workload_max_hours between 1 and 60);
alter table public.school add column if not exists workload_min_hours smallint not null default 8 check (workload_min_hours between 0 and 60);

create or replace function public.faculty_workload(p_semester bigint)
returns table (staff_id bigint, staff_name text, department text, courses text, sections int, planned_hours numeric, timetabled_periods int, clashes int, load text)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.semester where id = p_semester and school_id = public.current_school_id()),
  sc as (select * from public.school where id = public.current_school_id()),
  -- each (teacher, section, course) running this semester
  t as (
    select distinct ta.staff_id, ta.section_id, c.id course_id, c.code, coalesce(c.lecture, 0) + coalesce(c.tutorial, 0) + coalesce(c.practical, 0) hrs, d.name dept
    from s join public.teacher_allotment ta on ta.academic_year_id = s.academic_year_id and ta.subject_id is not null
    join public.subject sb on sb.id = ta.subject_id join public.course c on c.id = sb.course_id
    join public.section sec on sec.id = ta.section_id join public.class cl on cl.id = sec.class_id
    join public.programme_course pc on pc.programme_id = cl.programme_id and pc.course_id = c.id
      and pc.semester_no = 2 * cl.year_no - case when s.kind = 'odd' then 1 else 0 end
    left join public.department d on d.id = c.department_id
    where ta.school_id = public.current_school_id()),
  per as (select t.staff_id, string_agg(distinct t.code, ', ') courses, count(distinct t.section_id)::int sections, sum(t.hrs) hrs,
                 mode() within group (order by t.dept) dept from t group by t.staff_id),
  tt as (select ts.staff_id, count(*)::int periods,
                (count(*) - count(distinct (ts.day_of_week, ts.period_no)))::int clashes
         from s join public.timetable_slot ts on ts.academic_year_id = s.academic_year_id and ts.staff_id is not null
         where ts.school_id = public.current_school_id() group by ts.staff_id)
  select st.id, st.full_name, per.dept, per.courses, coalesce(per.sections, 0), coalesce(per.hrs, 0), coalesce(tt.periods, 0), coalesce(tt.clashes, 0),
    case when coalesce(per.hrs, 0) > sc.workload_max_hours then 'over' when coalesce(per.hrs, 0) < sc.workload_min_hours then 'under' else 'ok' end
  from public.staff st cross join sc
  left join per on per.staff_id = st.id left join tt on tt.staff_id = st.id
  where st.school_id = public.current_school_id() and st.role in ('subject_teacher', 'class_teacher') and (per.staff_id is not null or tt.staff_id is not null)
    and (coalesce(app.is_admin_scope(), false) or app.is_exams()
         or exists (select 1 from public.teacher_allotment a where a.staff_id = st.id and a.section_id in (select app.my_scope_sections())))
  order by coalesce(per.hrs, 0) desc, st.full_name;
$$;
grant execute on function public.faculty_workload(bigint) to authenticated;

-- ---------- 3. electives across sections ----------
-- everyone registered this semester in the course behind a subject, in sections where the teacher teaches it
create or replace function public.course_roster(p_subject bigint)
returns table (student_id bigint, student_name text, roll_no int, section_id bigint, section_label text)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.semester where school_id = public.current_school_id() and is_current),
  mine as (select ta.section_id from s join public.teacher_allotment ta on ta.academic_year_id = s.academic_year_id
           where ta.subject_id = p_subject and (ta.staff_id = app.my_staff_id() or coalesce(app.is_office(), false)))
  select distinct st.id, st.full_name, e.roll_no::int, e.section_id, c.name || '-' || sec.name
  from s join public.course_registration r on r.semester_id = s.id and r.status <> 'dropped'
  join public.programme_course pc on pc.id = r.programme_course_id
  join public.subject sb on sb.id = p_subject and sb.course_id = pc.course_id
  join public.student st on st.id = r.student_id
  join public.student_enrollment e on e.student_id = st.id and e.academic_year_id = s.academic_year_id and e.status = 'active'
  join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
  where e.section_id in (select section_id from mine)
  order by 5, 3 nulls last, 2;
$$;
grant execute on function public.course_roster(bigint) to authenticated;

-- the teacher's elective courses taught across more than one section
create or replace function public.my_elective_courses()
returns table (subject_id bigint, subject_name text, sections int)
language sql stable security definer set search_path = '' as $$
  select sb.id, sb.name, count(distinct ta.section_id)::int
  from public.semester s join public.teacher_allotment ta on ta.academic_year_id = s.academic_year_id and ta.staff_id = app.my_staff_id()
  join public.subject sb on sb.id = ta.subject_id
  where s.school_id = public.current_school_id() and s.is_current
    and exists (select 1 from public.programme_course pc where pc.course_id = sb.course_id and pc.elective_group is not null)
  group by sb.id, sb.name having count(distinct ta.section_id) > 1;
$$;
grant execute on function public.my_elective_courses() to authenticated;

-- one lecture for the whole course roster; the lock applies per section
create or replace function public.mark_course_lecture(p_subject bigint, p_date date, p_period smallint, p_absent bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_year bigint; n int; v_sec bigint; v_lock text;
begin
  select academic_year_id into v_year from public.semester where school_id = v_school and is_current;
  if v_year is null then raise exception 'No current semester'; end if;
  if not exists (select 1 from public.teacher_allotment ta where ta.subject_id = p_subject and ta.academic_year_id = v_year and (ta.staff_id = app.my_staff_id() or coalesce(app.is_office(), false))) then
    raise exception 'Only the teacher of this course can mark it';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'A lecture cannot be marked for a future day'; end if;
  for v_sec in select distinct r.section_id from public.course_roster(p_subject) r loop
    v_lock := public.lecture_lock_reason(v_sec, p_subject, p_date);
    if v_lock is not null then raise exception '%', v_lock; end if;
  end loop;
  delete from public.attendance_record a using public.course_roster(p_subject) r
   where a.student_id = r.student_id and a.subject_id = p_subject and a.on_date = p_date and a.period = p_period;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, marked_by, school_id)
  select r.student_id, r.section_id, v_year, p_date, p_period, p_subject,
         (case when r.student_id = any(coalesce(p_absent, '{}')) then 'absent' else 'present' end)::public.attendance_status, app.my_staff_id(), v_school
  from public.course_roster(p_subject) r;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_course_lecture(bigint, date, smallint, bigint[]) from public, anon;
grant execute on function public.mark_course_lecture(bigint, date, smallint, bigint[]) to authenticated;
commit;
notify pgrst, 'reload schema';
