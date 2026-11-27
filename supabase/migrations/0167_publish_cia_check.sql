-- Publishing waits for the internal-marks sign-off when the institution requires it.
begin;
create or replace function public.publish_semester_results(p_semester bigint, p_section bigint, p_revise_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_sem public.semester; v_cr jsonb; v_ids bigint[]; v_redo bigint[]; v_by bigint := app.my_staff_id(); v_as text;
  v_revise boolean := coalesce(trim(p_revise_reason), '') <> '';
begin
  if not app.can_publish_results() then raise exception 'Results are published by the Controller of Examinations (or the registrar or office where there is none)'; end if;
  select * into v_sem from public.semester where id = p_semester and school_id = v_school;
  if v_sem.id is null then raise exception 'Unknown semester'; end if;
  -- internal marks signed off by the Head of Department, when the institution asks for it
  perform public.check_cia_signoff(p_semester, p_section);
  v_as := public.staff_titles(v_by);
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cr from public.compute_course_results(p_semester, p_section) c;

  -- who is published now: complete, and new or being revised
  with cr as (select * from jsonb_to_recordset(v_cr) as x(student_id bigint, status text)),
  st as (select cr.student_id, bool_and(cr.status in ('pass', 'fail', 'absent')) complete,
                exists (select 1 from public.semester_result sr where sr.semester_id = p_semester and sr.student_id = cr.student_id) done
         from cr group by cr.student_id)
  select coalesce(array_agg(student_id) filter (where complete and (not done or v_revise)), '{}'),
         coalesce(array_agg(student_id) filter (where complete and done and v_revise), '{}')
    into v_ids, v_redo from st;
  if cardinality(v_ids) = 0 then return 0; end if;

  -- revising: keep the old rows, then replace them
  if cardinality(v_redo) > 0 then
    insert into public.course_result_revision (school_id, revised_by, reason, old)
    select v_school, v_by, left(p_revise_reason, 200), to_jsonb(cr) from public.course_result cr
     where cr.semester_id = p_semester and cr.attempt = 1 and cr.student_id = any(v_redo);
    delete from public.course_result where semester_id = p_semester and attempt = 1 and student_id = any(v_redo);
  end if;

  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, cia, cia_max, ese, ese_max, percent, grade, point, passed)
  select v_school, p_semester, c.student_id, c.course_id, 1, c.credits, c.cia, c.cia_max, c.ese, c.ese_max, c.percent, c.grade, coalesce(c.point, 0), c.passed
  from jsonb_to_recordset(v_cr) as c(student_id bigint, course_id bigint, credits numeric, cia numeric, cia_max numeric, ese numeric, ese_max numeric,
                                     percent numeric, grade text, point numeric, passed boolean, status text)
  where c.student_id = any(v_ids);

  -- grace marks within the scheme's limits
  perform public.apply_grace(p_semester, v_ids);

  -- the semester line per student (failed courses count in the GPA unless the scheme says otherwise)
  insert into public.semester_result (school_id, semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, published_by, published_as)
  select v_school, p_semester, cr.student_id,
    f.semester_no,
    sum(cr.credits), coalesce(sum(cr.credits) filter (where cr.passed), 0),
    round(sum(cr.credits * cr.point) filter (where cr.passed or coalesce(f.fail_counts, true)) / nullif(sum(cr.credits) filter (where cr.passed or coalesce(f.fail_counts, true)), 0), 2),
    null, count(*) filter (where not cr.passed), v_by, v_as
  from public.course_result cr
  left join lateral (
    select es.fail_counts_in_gpa fail_counts, (2 * c.year_no - case when v_sem.kind = 'odd' then 1 else 0 end)::smallint semester_no
    from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    join public.programme p on p.id = c.programme_id left join public.eval_scheme es on es.id = p.eval_scheme_id
    where e.student_id = cr.student_id and e.academic_year_id = v_sem.academic_year_id order by (e.status = 'active') desc limit 1) f on true
  where cr.semester_id = p_semester and cr.attempt = 1 and cr.student_id = any(v_ids)
  group by cr.student_id, f.fail_counts, f.semester_no
  on conflict (semester_id, student_id) do update set credits_registered = excluded.credits_registered, credits_earned = excluded.credits_earned,
    sgpa = excluded.sgpa, backlogs = excluded.backlogs, semester_no = excluded.semester_no, published_by = excluded.published_by,
    published_as = excluded.published_as, published_at = now();

  -- revaluations already decided stay applied after a revision
  perform public.reapply_revaluations(p_semester, v_ids);
  -- CGPA of every published semester of these students
  perform public.refresh_cgpa(v_ids);

  return cardinality(v_ids);
end $$;
revoke all on function public.publish_semester_results(bigint, bigint, text) from public, anon;
grant execute on function public.publish_semester_results(bigint, bigint, text) to authenticated;
commit;
