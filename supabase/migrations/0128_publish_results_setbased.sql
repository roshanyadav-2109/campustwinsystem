-- Publishing results without a temporary table (works through the API).
begin;
create or replace function public.publish_semester_results(p_semester bigint, p_section bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); n int;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can publish results'; end if;
  -- the students whose every course is complete: replace their first-attempt results
  delete from public.course_result d
   where d.semester_id = p_semester and d.attempt = 1
     and d.student_id in (select c.student_id from public.compute_course_results(p_semester, p_section) c group by c.student_id having bool_and(c.status in ('pass', 'fail')));
  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
  select v_school, p_semester, c.student_id, c.course_id, 1, c.credits, c.cia, c.cia_max, c.ese, c.ese_max, c.percent, c.grade, coalesce(c.point, 0), c.passed
  from (select x.*, bool_and(x.status in ('pass', 'fail')) over (partition by x.student_id) complete from public.compute_course_results(p_semester, p_section) x) c
  where c.complete;

  insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs)
  select v_school, p_semester, cr.student_id,
    (select ss.semester_no from public.student_semester(cr.student_id, p_semester) ss limit 1),
    sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
    round(sum(cr.credits * cr.point) / nullif(sum(cr.credits), 0), 2), null, count(*) filter (where not cr.passed)
  from public.course_result cr
  where cr.semester_id = p_semester and cr.student_id in (select e.student_id from public.student_enrollment e join public.semester s on s.id = p_semester
        where e.section_id = p_section and e.academic_year_id = s.academic_year_id)
  group by cr.student_id
  on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
    sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_at = now();
  get diagnostics n = row_count;

  -- CGPA: every published course of each student, its latest attempt
  update public.semester_result sr set cgpa = x.cgpa
  from (select l.student_id, round(sum(l.credits * l.point) / nullif(sum(l.credits), 0), 2) cgpa
        from (select distinct on (cr.student_id, cr.course_id) cr.student_id, cr.credits, cr.point from public.course_result cr
              where cr.school_id = v_school order by cr.student_id, cr.course_id, cr.published_at desc, cr.attempt desc) l
        group by l.student_id) x
  where sr.semester_id = p_semester and sr.student_id = x.student_id;
  return n;
end $$;
revoke all on function public.publish_semester_results(bigint, bigint) from public, anon;
grant execute on function public.publish_semester_results(bigint, bigint) to authenticated;
commit;
