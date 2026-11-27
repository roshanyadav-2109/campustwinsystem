-- Higher education, step 7: semester exams use the exam timetable and admit
-- cards (hall tickets) too. For a college or university campus a hall ticket
-- lists only the courses the student registered for in the current semester,
-- and is held back when attendance in any course is below the minimum and not
-- condoned. Schools are unchanged.
begin;
drop function if exists public.prepare_admit_cards(bigint, bigint, bigint);
create function public.prepare_admit_cards(p_session bigint, p_section bigint, p_student bigint default null)
returns table (student_id bigint, student_name text, admission_no text, roll_no int, class_label text, photo_path text,
               withheld boolean, reason text, verify_token text, subject_ids bigint[])
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_s public.exam_session; v_first date; v_he boolean; v_sem public.semester; v_min numeric;
begin
  select * into v_s from public.exam_session where id = p_session and school_id = v_school;
  if v_s.id is null then raise exception 'Unknown exam'; end if;
  if not exists (select 1 from public.section where id = p_section and school_id = v_school) then raise exception 'Unknown section'; end if;
  if p_student is not null then
    if not (app.is_admin_scope() or app.owns_student(p_student)) then raise exception 'Not allowed'; end if;
    if not app.is_admin_scope() and v_s.published_at is null then raise exception 'This exam is not published yet'; end if;
  elsif not (app.is_admin_scope() or app.ct_of_section(p_section, v_s.academic_year_id)) then
    raise exception 'Only the office or the class teacher can print admit cards';
  end if;
  v_he := public.is_higher_ed(v_school);
  select * into v_sem from public.semester where school_id = v_school and is_current;
  select attendance_minimum into v_min from public.school where id = v_school;
  select min(p.exam_date) into v_first from public.exam_paper p join public.section sec on sec.class_id = p.class_id where p.session_id = p_session and sec.id = p_section;
  insert into public.exam_admit_card (school_id, session_id, student_id)
  select v_school, p_session, e.student_id from public.student_enrollment e
   where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student)
  on conflict do nothing;
  return query
  with base as (
    select st.id sid, st.full_name, st.admission_no, e.roll_no::int roll, c.name || '-' || sec.name cls, st.photo_path, ac.verify_token tok,
      (select coalesce(sum(i.amount - coalesce(i.paid_amount, 0)), 0) from public.fee_invoice i
        where i.student_id = st.id and i.status in ('due', 'part') and i.due_date < coalesce(v_first, current_date)) bal,
      case when v_he and v_sem.id is not null then (
        select array_agg(distinct sb.id) from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id
        join public.subject sb on sb.course_id = pc.course_id and sb.school_id = v_school
        where r.semester_id = v_sem.id and r.student_id = st.id and r.status <> 'dropped') end subj,
      case when v_he and v_sem.id is not null then (
        select string_agg(x.sname, ', ') from (
          select sb.name sname from public.attendance_record a join public.subject sb on sb.id = a.subject_id
          where a.student_id = st.id and a.period is not null and a.subject_id is not null and a.on_date between v_sem.starts_on and v_sem.ends_on
          group by sb.id, sb.name
          having 100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*) < v_min
             and not exists (select 1 from public.attendance_condonation cd where cd.semester_id = v_sem.id and cd.student_id = st.id and cd.subject_id = sb.id)) x) end short
    from public.student_enrollment e
    join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.exam_admit_card ac on ac.session_id = p_session and ac.student_id = st.id
    where e.section_id = p_section and e.academic_year_id = v_s.academic_year_id and e.status = 'active' and (p_student is null or e.student_id = p_student))
  select b.sid, b.full_name, b.admission_no, b.roll, b.cls, b.photo_path,
    (v_s.withhold_fee_dues and b.bal > 0) or b.short is not null,
    case when b.short is not null then 'Attendance below ' || v_min || '% in ' || b.short
         when v_s.withhold_fee_dues and b.bal > 0 then (case when app.is_office() or app.owns_student(b.sid) then 'Fees overdue: Rs ' || to_char(b.bal, 'FM99,99,99,990.00') else 'Held back by the office' end) end,
    case when (v_s.withhold_fee_dues and b.bal > 0) or b.short is not null then null else b.tok end,
    b.subj
  from base b
  order by b.roll nulls last, b.full_name;
end $$;
grant execute on function public.prepare_admit_cards(bigint, bigint, bigint) to authenticated;
commit;
