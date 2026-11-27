-- Demo data only (is_sample colleges and campuses): an evaluation scheme with
-- the UGC 10-point scale, core courses registered for the odd semester, and
-- end-semester marks that follow each student's internal marks, with a few
-- failures. Real institutions are not touched.
begin;
do $$
declare s record; v_sch bigint; v_it bigint; v_mid bigint; v_ese bigint; v_sem record; a record;
begin
  for s in select id from public.school where is_sample and public.is_higher_ed(id) loop
    select id into v_it from public.assessment_type where school_id = s.id and code = 'periodic_test';
    select id into v_mid from public.assessment_type where school_id = s.id and code = 'half_yearly';
    select id into v_ese from public.assessment_type where school_id = s.id and code = 'annual';
    if v_it is null or v_mid is null or v_ese is null then continue; end if;
    insert into public.eval_scheme (school_id, name, ese_min_percent, pass_percent) values (s.id, 'Standard (CIA 40 + ESE 60)', 40, 40)
      on conflict (school_id, name) do nothing;
    select id into v_sch from public.eval_scheme where school_id = s.id and name = 'Standard (CIA 40 + ESE 60)';
    if not exists (select 1 from public.eval_component where scheme_id = v_sch) then
      insert into public.eval_component (school_id, scheme_id, part, name, assessment_type_id, rule, weight) values
        (s.id, v_sch, 'cia', 'Internal tests', v_it, 'average', 20),
        (s.id, v_sch, 'cia', 'Mid-semester exam', v_mid, 'sum', 20),
        (s.id, v_sch, 'ese', 'End-semester exam', v_ese, 'sum', 60);
      insert into public.eval_grade (school_id, scheme_id, min_percent, grade, point) values
        (s.id, v_sch, 90, 'O', 10), (s.id, v_sch, 80, 'A+', 9), (s.id, v_sch, 70, 'A', 8), (s.id, v_sch, 60, 'B+', 7),
        (s.id, v_sch, 50, 'B', 6), (s.id, v_sch, 45, 'C', 5), (s.id, v_sch, 40, 'P', 4), (s.id, v_sch, 0, 'F', 0);
    end if;
    update public.programme set eval_scheme_id = v_sch where school_id = s.id and eval_scheme_id is null;

    select * into v_sem from public.semester where school_id = s.id and kind = 'odd' order by starts_on desc limit 1;
    if v_sem.id is null then continue; end if;
    -- core courses of the odd semester for every student
    insert into public.course_registration (school_id, semester_id, student_id, programme_course_id, status)
    select s.id, v_sem.id, e.student_id, pc.id, 'approved'
    from public.student_enrollment e
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id and c.programme_id is not null
    join public.programme_course pc on pc.programme_id = c.programme_id and pc.elective_group is null and pc.semester_no = 2 * c.year_no - 1
    where e.academic_year_id = v_sem.academic_year_id and e.status = 'active' and e.school_id = s.id
    on conflict do nothing;
    -- an end-semester exam (out of 100) for each section and odd-semester course
    for a in
      select distinct sec.id section_id, sb.id subject_id
      from public.section sec join public.class c on c.id = sec.class_id and c.programme_id is not null
      join public.programme_course pc on pc.programme_id = c.programme_id and pc.semester_no = 2 * c.year_no - 1
      join public.subject sb on sb.course_id = pc.course_id and sb.school_id = s.id
      join public.class_subject cs on cs.class_id = c.id and cs.subject_id = sb.id
      where sec.school_id = s.id
    loop
      if not exists (select 1 from public.assessment x where x.section_id = a.section_id and x.subject_id = a.subject_id and x.term = 1 and x.assessment_type_id = v_ese and x.academic_year_id = v_sem.academic_year_id) then
        insert into public.assessment (assessment_type_id, subject_id, section_id, academic_year_id, term, name, assessed_on, max_marks, school_id, is_published)
        values (v_ese, a.subject_id, a.section_id, v_sem.academic_year_id, 1, 'End-Semester Examination', v_sem.ends_on - 5, 100, s.id, true);
      end if;
    end loop;
    -- marks: close to the student's internal percentage, about 1 in 12 failing
    insert into public.mark (assessment_id, student_id, marks_obtained, is_absent, school_id)
    select x.id, e.student_id,
      case when random() < 0.08 then round((15 + random() * 20)::numeric, 0)
           else round(least(100, greatest(40, coalesce((
             select avg(m.marks_obtained / nullif(a2.max_marks, 0)) * 100 from public.mark m join public.assessment a2 on a2.id = m.assessment_id
             where m.student_id = e.student_id and a2.subject_id = x.subject_id and a2.term = 1 and a2.assessment_type_id in (v_it, v_mid)), 60) + (random() * 16 - 8)))::numeric, 0) end,
      false, s.id
    from public.assessment x
    join public.student_enrollment e on e.section_id = x.section_id and e.academic_year_id = x.academic_year_id and e.status = 'active'
    where x.school_id = s.id and x.assessment_type_id = v_ese and x.term = 1
    on conflict (assessment_id, student_id) do nothing;
  end loop;
end $$;
commit;
