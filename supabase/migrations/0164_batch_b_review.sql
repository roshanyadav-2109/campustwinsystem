-- Batch B: fixes from the product + CTO review.
begin;
create or replace function public.subject_is_elective(p_subject bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.subject sb join public.programme_course pc on pc.course_id = sb.course_id where sb.id = p_subject and pc.elective_group is not null);
$$;
grant execute on function public.subject_is_elective(bigint) to authenticated;

create or replace function public.prepare_admit_cards(p_session bigint, p_section bigint, p_student bigint default null)
returns table (student_id bigint, student_name text, admission_no text, roll_no int, class_label text, photo_path text,
               withheld boolean, reason text, verify_token text, subject_ids bigint[])
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_s public.exam_session; v_first date; v_he boolean; v_sem public.semester; v_min numeric;
begin
  select * into v_s from public.exam_session where id = p_session and school_id = v_school;
  if v_s.id is null then raise exception 'Unknown exam'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if p_student is not null then
    if not (app.is_admin_scope() or app.is_exams() or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
    if not (app.is_admin_scope() or app.is_exams()) and v_s.published_at is null then raise exception 'This exam is not published yet'; end if;
  elsif not (app.is_admin_scope() or app.is_exams() or app.ct_of_section(p_section, v_s.academic_year_id)) then
    raise exception 'Only the office or the class teacher can print admit cards';
  end if;
  v_he := public.is_higher_ed(v_school);
  -- the exam's own semester (term 1 = odd, 2 = even of the exam's year); the current one if there is none
  select * into v_sem from public.semester where school_id = v_school and academic_year_id = v_s.academic_year_id
     and kind = case v_s.term when 1 then 'odd' when 2 then 'even' else kind end order by is_current desc, starts_on desc limit 1;
  if v_sem.id is null then select * into v_sem from public.semester where school_id = v_school and is_current; end if;
  select attendance_minimum into v_min from public.school where id = v_school;
  select min(p.exam_date) into v_first from public.exam_paper p join public.section sec on sec.class_id = p.class_id where p.session_id = p_session and sec.id = p_section;
  insert into public.exam_admit_card (school_id, session_id, student_id)
  select v_school, p_session, e.student_id from public.student_enrollment e
   where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
     and (v_s.kind not in ('supplementary', 'improvement') or exists (select 1 from public.supp_registration sr where sr.session_id = p_session and sr.student_id = e.student_id))
  on conflict do nothing;
  return query
  with base as (
    select st.id sid, st.full_name, st.admission_no, e.roll_no::int roll, c.name || '-' || sec.name cls, st.photo_path, ac.verify_token tok,
      case when v_s.kind in ('supplementary', 'improvement') then (
             -- the supplementary fee must be paid (or extended) before the hall ticket, whatever its due date
             select coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0) from public.fee_invoice i
             where i.id in (select sr.invoice_id from public.supp_registration sr where sr.session_id = p_session and sr.student_id = st.id)
               and i.status in ('due', 'part') and not public.fee_relaxed(st.id, current_date))
           when v_s.withhold_fee_dues and not public.fee_relaxed(st.id, coalesce(v_first, current_date)) then public.overdue_fees(st.id, coalesce(v_first, current_date)) else 0 end bal,
      case when v_s.kind in ('supplementary', 'improvement') then (
        select array_agg(distinct sb.id) from public.supp_registration sr join public.subject sb on sb.course_id = sr.course_id and sb.school_id = v_school
        where sr.session_id = p_session and sr.student_id = st.id)
           when v_he and v_sem.id is not null then (
        select array_agg(distinct sb.id) from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id
        join public.subject sb on sb.course_id = pc.course_id and sb.school_id = v_school
        where r.semester_id = v_sem.id and r.student_id = st.id and r.status <> 'dropped') end subj,
      case when v_he and v_sem.id is not null and v_s.kind not in ('supplementary', 'improvement') then public.attendance_shortage(st.id, v_sem.id) end short
    from public.student_enrollment e
    join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.exam_admit_card ac on ac.session_id = p_session and ac.student_id = st.id
    where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
      and (v_s.kind not in ('supplementary', 'improvement') or exists (select 1 from public.supp_registration sr where sr.session_id = p_session and sr.student_id = st.id)))
  select b.sid, b.full_name, b.admission_no, b.roll, b.cls, b.photo_path,
    b.bal > 0 or b.short is not null,
    case when b.short is not null then 'Attendance below ' || v_min || '% in ' || b.short
         when b.bal > 0 then (case when app.is_office() or app.owns_student(b.sid) then 'Fees overdue: Rs ' || to_char(b.bal, 'FM99,99,99,990.00') else 'Held back by the office' end) end,
    case when b.bal > 0 or b.short is not null then null else b.tok end,
    b.subj
  from base b
  order by b.roll nulls last, b.full_name;
end $$;
grant execute on function public.prepare_admit_cards(bigint, bigint, bigint) to authenticated;

-- every candidate of a supplementary or improvement exam, whatever their section now
create or replace function public.prepare_supp_admit_cards(p_session bigint)
returns table (student_id bigint, student_name text, admission_no text, roll_no int, class_label text, photo_path text,
               withheld boolean, reason text, verify_token text, subject_ids bigint[])
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_s public.exam_session;
begin
  select * into v_s from public.exam_session where id = p_session and school_id = v_school;
  if v_s.id is null or v_s.kind not in ('supplementary', 'improvement') then raise exception 'Choose a supplementary or improvement exam'; end if;
  if not (app.is_exams() or coalesce(app.is_admin_scope(), false)) then raise exception 'Only the exam cell can print all hall tickets'; end if;
  insert into public.exam_admit_card (school_id, session_id, student_id)
  select distinct v_school, p_session, sr.student_id from public.supp_registration sr where sr.session_id = p_session on conflict do nothing;
  return query
  with base as (
    select st.id sid, st.full_name, st.admission_no, st.photo_path, ac.verify_token tok,
      (select array_agg(distinct sb.id) from public.supp_registration sr join public.subject sb on sb.course_id = sr.course_id and sb.school_id = v_school
        where sr.session_id = p_session and sr.student_id = st.id) subj,
      (select coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0) from public.fee_invoice i
        where i.id in (select sr.invoice_id from public.supp_registration sr where sr.session_id = p_session and sr.student_id = st.id)
          and i.status in ('due', 'part') and not public.fee_relaxed(st.id, current_date)) bal,
      (select g.name from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
         left join public.programme g on g.id = c.programme_id where e.student_id = st.id order by (e.status = 'active') desc, e.academic_year_id desc limit 1) prog
    from (select distinct sr.student_id from public.supp_registration sr where sr.session_id = p_session) x
    join public.student st on st.id = x.student_id
    join public.exam_admit_card ac on ac.session_id = p_session and ac.student_id = st.id)
  select b.sid, b.full_name, b.admission_no, null::int, coalesce(b.prog, ''), b.photo_path, b.bal > 0,
    case when b.bal > 0 then 'Exam fee not paid: Rs ' || to_char(b.bal, 'FM99,99,99,990.00') end,
    case when b.bal > 0 then null else b.tok end, b.subj
  from base b order by b.full_name;
end $$;
revoke all on function public.prepare_supp_admit_cards(bigint) from public, anon;
grant execute on function public.prepare_supp_admit_cards(bigint) to authenticated;

create or replace function public.mark_lecture(p_section bigint, p_subject bigint, p_date date, p_period smallint, p_absent bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_year bigint; n int; v_lock text; v_old bigint[]; v_had boolean;
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
  v_lock := public.lecture_lock_reason(p_section, p_subject, p_date);
  if v_lock is not null then raise exception '%', v_lock; end if;
  select count(*) > 0, coalesce(array_agg(student_id order by student_id) filter (where status = 'absent'), '{}') into v_had, v_old
    from public.attendance_record where section_id = p_section and subject_id = p_subject and on_date = p_date and period = p_period;
  delete from public.attendance_record where section_id = p_section and subject_id = p_subject and on_date = p_date and period = p_period;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, marked_by, school_id)
  select e.student_id, p_section, v_year, p_date, p_period, p_subject,
         (case when e.student_id = any(coalesce(p_absent, '{}')) then 'absent' else 'present' end)::public.attendance_status, app.my_staff_id(), v_school
  from public.student_enrollment e where e.section_id = p_section and e.academic_year_id = v_year and e.status = 'active'
    and (not public.subject_is_elective(p_subject)
         or exists (select 1 from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id join public.subject sb on sb.id = p_subject and sb.course_id = pc.course_id
                    join public.semester s on s.id = r.semester_id and s.is_current where r.student_id = e.student_id and r.status <> 'dropped'));
  get diagnostics n = row_count;
  if v_had and v_old is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_absent, '{}')) x) then
    insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent)
    values (v_school, p_section, p_subject, p_date, p_period, app.my_staff_id(), v_old, coalesce(p_absent, '{}'));
  end if;
  return n;
end $$;

-- an elective lecture for the whole course: the period must be free for every student,
-- each section's lock applies, and changes are logged per section
create or replace function public.mark_course_lecture(p_subject bigint, p_date date, p_period smallint, p_absent bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_year bigint; n int; v_sec record; v_lock text; v_busy text; v_old bigint[]; v_had boolean; v_roster jsonb;
begin
  select academic_year_id into v_year from public.semester where school_id = v_school and is_current;
  if v_year is null then raise exception 'No current semester'; end if;
  if not exists (select 1 from public.teacher_allotment ta where ta.subject_id = p_subject and ta.academic_year_id = v_year and (ta.staff_id = app.my_staff_id() or coalesce(app.is_office(), false))) then
    raise exception 'Only the teacher of this course can mark it';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'A lecture cannot be marked for a future day'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('student_id', r.student_id, 'student_name', r.student_name, 'section_id', r.section_id, 'section_label', r.section_label)), '[]'::jsonb)
    into v_roster from public.course_roster(p_subject) r;
  for v_sec in select distinct rn.section_id, rn.section_label from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) loop
    v_lock := public.lecture_lock_reason(v_sec.section_id, p_subject, p_date);
    if v_lock is not null then raise exception '% (%)', v_lock, v_sec.section_label; end if;
  end loop;
  select string_agg(distinct rn.student_name, ', ') into v_busy from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text)
    join public.attendance_record a on a.student_id = rn.student_id and a.on_date = p_date and a.period = p_period and a.subject_id is distinct from p_subject;
  if v_busy is not null then raise exception 'Period % on that day is already marked for another course for: %', p_period, left(v_busy, 200); end if;
  for v_sec in select distinct rn.section_id from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) loop
    select count(*) > 0, coalesce(array_agg(a.student_id order by a.student_id) filter (where a.status = 'absent'), '{}') into v_had, v_old
      from public.attendance_record a join jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) on rn.student_id = a.student_id and rn.section_id = v_sec.section_id
     where a.subject_id = p_subject and a.on_date = p_date and a.period = p_period;
    if v_had and v_old is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_absent, '{}')) x
                                         where x in (select rn.student_id from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) where rn.section_id = v_sec.section_id)) then
      insert into public.attendance_change_log (school_id, section_id, subject_id, on_date, period, changed_by, old_absent, new_absent)
      select v_school, v_sec.section_id, p_subject, p_date, p_period, app.my_staff_id(), v_old,
             coalesce((select array_agg(x order by x) from unnest(coalesce(p_absent, '{}')) x where x in (select rn.student_id from jsonb_to_recordset(v_roster) as rn(student_id bigint, student_name text, section_id bigint, section_label text) where rn.section_id = v_sec.section_id)), '{}');
    end if;
  end loop;
  delete from public.attendance_record a using jsonb_to_recordset(v_roster) as r(student_id bigint, student_name text, section_id bigint, section_label text)
   where a.student_id = r.student_id and a.subject_id = p_subject and a.on_date = p_date and a.period = p_period;
  insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, marked_by, school_id)
  select r.student_id, r.section_id, v_year, p_date, p_period, p_subject,
         (case when r.student_id = any(coalesce(p_absent, '{}')) then 'absent' else 'present' end)::public.attendance_status, app.my_staff_id(), v_school
  from jsonb_to_recordset(v_roster) as r(student_id bigint, student_name text, section_id bigint, section_label text);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_course_lecture(bigint, date, smallint, bigint[]) from public, anon;
grant execute on function public.mark_course_lecture(bigint, date, smallint, bigint[]) to authenticated;

-- electives (one section or more); the office sees every elective that has a teacher
create or replace function public.my_elective_courses()
returns table (subject_id bigint, subject_name text, sections int)
language sql stable security definer set search_path = '' as $$
  select sb.id, sb.name, count(distinct ta.section_id)::int
  from public.semester s join public.teacher_allotment ta on ta.academic_year_id = s.academic_year_id
    and (ta.staff_id = app.my_staff_id() or coalesce(app.is_office(), false))
  join public.subject sb on sb.id = ta.subject_id
  where s.school_id = public.current_school_id() and s.is_current and public.subject_is_elective(sb.id)
  group by sb.id, sb.name;
$$;
revoke all on function public.my_elective_courses() from public, anon;
grant execute on function public.my_elective_courses() to authenticated;

-- workload: an elective taught to several sections together counts once; a clash is two subjects at one time
create or replace function public.faculty_workload(p_semester bigint)
returns table (staff_id bigint, staff_name text, department text, courses text, sections int, planned_hours numeric, timetabled_periods int, clashes int, load text)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.semester where id = p_semester and school_id = public.current_school_id()),
  sc as (select * from public.school where id = public.current_school_id()),
  t as (
    select distinct ta.staff_id, ta.section_id, c.id course_id, c.code, coalesce(c.lecture, 0) + coalesce(c.tutorial, 0) + coalesce(c.practical, 0) hrs, d.name dept,
      (pc.elective_group is not null) elective
    from s join public.teacher_allotment ta on ta.academic_year_id = s.academic_year_id and ta.subject_id is not null
    join public.subject sb on sb.id = ta.subject_id join public.course c on c.id = sb.course_id
    join public.section sec on sec.id = ta.section_id join public.class cl on cl.id = sec.class_id
    join public.programme_course pc on pc.programme_id = cl.programme_id and pc.course_id = c.id
      and pc.semester_no = 2 * cl.year_no - case when s.kind = 'odd' then 1 else 0 end
    left join public.department d on d.id = c.department_id
    where ta.school_id = public.current_school_id()),
  units as (select staff_id, course_id, max(hrs) hrs from t where elective group by staff_id, course_id
            union all select staff_id, course_id, hrs from t where not elective),
  per as (select t.staff_id, string_agg(distinct t.code, ', ') courses, count(distinct t.section_id)::int sections, mode() within group (order by t.dept) dept from t group by t.staff_id),
  hrs as (select staff_id, sum(hrs) hrs from units group by staff_id),
  tt as (select ts.staff_id, count(distinct (ts.day_of_week, ts.period_no, ts.subject_id))::int periods,
                (count(distinct (ts.day_of_week, ts.period_no, ts.subject_id)) - count(distinct (ts.day_of_week, ts.period_no)))::int clashes
         from s join public.timetable_slot ts on ts.academic_year_id = s.academic_year_id and ts.staff_id is not null
         where ts.school_id = public.current_school_id() group by ts.staff_id)
  select st.id, st.full_name, per.dept, per.courses, coalesce(per.sections, 0), coalesce(hrs.hrs, 0), coalesce(tt.periods, 0), coalesce(tt.clashes, 0),
    case when coalesce(hrs.hrs, 0) > sc.workload_max_hours then 'over' when coalesce(hrs.hrs, 0) < sc.workload_min_hours then 'under' else 'ok' end
  from public.staff st cross join sc
  left join per on per.staff_id = st.id left join hrs on hrs.staff_id = st.id left join tt on tt.staff_id = st.id
  where st.school_id = public.current_school_id() and st.role in ('subject_teacher', 'class_teacher') and (per.staff_id is not null or tt.staff_id is not null)
    and (coalesce(app.is_admin_scope(), false) or app.is_exams()
         or exists (select 1 from public.teacher_allotment a where a.staff_id = st.id and a.section_id in (select app.my_scope_sections())))
  order by coalesce(hrs.hrs, 0) desc, st.full_name;
$$;
revoke all on function public.faculty_workload(bigint) from public, anon;
grant execute on function public.faculty_workload(bigint) to authenticated;
revoke all on function public.course_roster(bigint) from public, anon;
grant execute on function public.course_roster(bigint) to authenticated;

create or replace function public.set_workload_limits(p_min int, p_max int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the head can change workload limits'; end if;
  if p_min < 0 or p_max < 1 or p_min > p_max or p_max > 60 then raise exception 'Give limits between 0 and 60 hours, the lower first'; end if;
  update public.school set workload_min_hours = p_min, workload_max_hours = p_max where id = public.current_school_id();
end $$;
revoke all on function public.set_workload_limits(int, int) from public, anon;
grant execute on function public.set_workload_limits(int, int) to authenticated;

-- families see the exam's course papers they sit
create or replace function public.my_supp_papers(p_student bigint)
returns table (id bigint, session_id bigint, subject_id bigint, exam_date date, starts_at time, ends_at time, max_marks numeric, note text, subject_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.session_id, p.subject_id, p.exam_date, p.starts_at, p.ends_at, p.max_marks, p.note, sb.name
  from public.exam_paper p join public.subject sb on sb.id = p.subject_id join public.exam_session s on s.id = p.session_id
  where p.class_id is null and p.school_id = public.current_school_id() and s.published_at is not null
    and exists (select 1 from public.supp_registration r where r.session_id = p.session_id and r.student_id = p_student and r.course_id = sb.course_id)
    and (app.owns_student(p_student) or app.my_staff_id() is not null)
  order by p.exam_date, p.starts_at;
$$;
grant execute on function public.my_supp_papers(bigint) to authenticated;
commit;
notify pgrst, 'reload schema';
