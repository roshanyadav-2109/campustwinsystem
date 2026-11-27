-- Publishing works the section's results out once, not once per student
-- (large sections hit the statement time limit).
begin;
create or replace function public.publish_semester_results(p_semester bigint, p_section bigint, p_revise_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); n int := 0; r record; v_sem public.semester; v_fail_counts boolean; v_cr jsonb;
begin
  if not app.can_publish_results() then raise exception 'Results are published by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into v_sem from public.semester where id = p_semester and school_id = v_school;
  -- work the section out once (it was recomputed for every student)
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cr from public.compute_course_results(p_semester, p_section) c;
  for r in
    select c.student_id, bool_and(c.status in ('pass', 'fail', 'absent')) complete,
           exists (select 1 from public.semester_result sr where sr.semester_id = p_semester and sr.student_id = c.student_id) done
    from jsonb_to_recordset(v_cr) as c(student_id bigint, course_id bigint, credits numeric, cia numeric, cia_max numeric, ese numeric, ese_max numeric, percent numeric, grade text, point numeric, passed boolean, status text) group by c.student_id
  loop
    continue when not r.complete;
    continue when r.done and coalesce(trim(p_revise_reason), '') = '';
    if r.done then
      insert into public.course_result_revision (school_id, revised_by, reason, old)
      select v_school, app.my_staff_id(), left(p_revise_reason, 200), to_jsonb(cr) from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id and cr.attempt = 1;
      delete from public.course_result where semester_id = p_semester and student_id = r.student_id and attempt = 1;
    end if;
    insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
    select v_school, p_semester, c.student_id, c.course_id, 1, c.credits, c.cia, c.cia_max, c.ese, c.ese_max, c.percent, c.grade, coalesce(c.point, 0), c.passed
    from jsonb_to_recordset(v_cr) as c(student_id bigint, course_id bigint, credits numeric, cia numeric, cia_max numeric, ese numeric, ese_max numeric, percent numeric, grade text, point numeric, passed boolean, status text) where c.student_id = r.student_id;
    select coalesce(es.fail_counts_in_gpa, true) into v_fail_counts
      from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
      join public.programme p on p.id = c.programme_id left join public.eval_scheme es on es.id = p.eval_scheme_id
     where e.student_id = r.student_id and e.academic_year_id = v_sem.academic_year_id limit 1;
    insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_by, published_as)
    select v_school, p_semester, r.student_id,
      (select ss.semester_no from public.student_semester(r.student_id, p_semester) ss limit 1),
      sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
      round(sum(cr.credits * cr.point) filter (where cr.passed or coalesce(v_fail_counts, true)) / nullif(sum(cr.credits) filter (where cr.passed or coalesce(v_fail_counts, true)), 0), 2),
      null, count(*) filter (where not cr.passed), app.my_staff_id(), public.staff_titles(app.my_staff_id())
    from public.course_result cr where cr.semester_id = p_semester and cr.student_id = r.student_id and cr.attempt = 1
    on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
      sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_by = excluded.published_by, published_as = excluded.published_as, published_at = now();
    perform public.recompute_cgpa(r.student_id);
    n := n + 1;
  end loop;
  return n;
end $$;
commit;
