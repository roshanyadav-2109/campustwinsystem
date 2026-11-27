-- Supplementary fee invoices are linked to the new registrations (a statement cannot update rows it inserted itself).
begin;
create or replace function public.register_backlogs(p_session bigint, p_student bigint default null, p_course bigint default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); s public.exam_session; n int; v_self boolean; v_new bigint[];
begin
  select * into s from public.exam_session where id = p_session and school_id = v_school;
  if s.id is null or s.kind <> 'supplementary' or s.for_semester_id is null then raise exception 'Choose a supplementary exam for a semester'; end if;
  v_self := not app.is_exams();
  if v_self then
    if p_student is null or p_course is null or not app.owns_student(p_student) then raise exception 'Only the exam cell can register others'; end if;
    if not s.self_registration or (s.registration_closes is not null and s.registration_closes < (now() at time zone 'Asia/Kolkata')::date) then raise exception 'Applications for this exam are closed'; end if;
  end if;
  with ins as (
    insert into public.supp_registration (school_id, session_id, student_id, course_id, semester_id, attempt, cia, cia_max, ese_max)
    select v_school, p_session, l.student_id, l.course_id, s.for_semester_id, l.attempt + 1, l.cia, l.cia_max, s.paper_max
    from (select distinct on (cr.student_id, cr.course_id) cr.student_id, cr.course_id, cr.attempt, cr.cia, cr.cia_max, cr.passed
          from public.course_result cr where cr.semester_id = s.for_semester_id and cr.school_id = v_school
            and (p_student is null or cr.student_id = p_student) and (p_course is null or cr.course_id = p_course)
          order by cr.student_id, cr.course_id, cr.attempt desc) l
    where not l.passed
      and not exists (select 1 from public.supp_registration x where x.student_id = l.student_id and x.course_id = l.course_id and x.status = 'registered')
    on conflict (session_id, student_id, course_id) do nothing
    returning id)
  select coalesce(array_agg(id), '{}'), count(*) into v_new, n from ins;
  -- the fee: one invoice per student for the new registrations (a second statement, so the new rows can be linked)
  if coalesce(s.fee_per_course, 0) > 0 and n > 0 then
    with per as (select student_id, count(*) c, min(id) first_id from public.supp_registration where id = any(v_new) group by student_id),
    inv as (
      insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, due_date, status)
      select v_school, per.student_id, public.section_in_semester(per.student_id, (select id from public.semester where school_id = v_school and is_current)),
             s.academic_year_id,
             left('Supplementary exam fee: ' || s.name || ' (' || per.c || ' course' || case when per.c > 1 then 's' else '' end || ') #' || s.id || '-' || per.first_id, 160),
             s.fee_per_course * per.c, coalesce(s.registration_closes, (now() at time zone 'Asia/Kolkata')::date + 14), 'due'
      from per
      returning id, student_id)
    update public.supp_registration sr set invoice_id = inv.id from inv where sr.student_id = inv.student_id and sr.id = any(v_new);
  end if;
  return n;
end $$;
commit;
