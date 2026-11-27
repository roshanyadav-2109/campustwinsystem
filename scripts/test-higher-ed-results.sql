-- Self-test for 0126 on Meridian (11): a course result against a hand
-- calculation, publishing, SGPA = credits x points / credits. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); v_staff bigint; v_sem bigint; v_sec bigint; r record; k bigint; c bigint; v_subj bigint;
  it numeric; k2 bigint; v_mark bigint; v_tok text; mid numeric; ese numeric; v_cia numeric; v_ese numeric; n int; v_sgpa numeric; ok boolean; v_g bigint;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-res-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA RES', 'qa-res-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA RES', 11, v_staff);
  -- the publisher is the Controller of Examinations
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_staff, id from public.position_title where school_id = 11 and access_type = 'exams_head' and scope_level in ('campus', 'university') limit 1;
  select id into v_sem from public.semester where school_id = 11 and kind = 'odd' order by starts_on desc limit 1;
  select e.section_id into v_sec from public.course_registration r2 join public.student_enrollment e on e.student_id = r2.student_id where r2.semester_id = v_sem and e.school_id = 11 limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from public.compute_course_results(v_sem, v_sec) x where x.status in ('pass', 'fail') limit 1;
  if r.student_id is null then raise exception 'FAIL no complete results'; end if;
  k := r.student_id; c := r.course_id;
  reset role;
  select sb.id into v_subj from public.subject sb join public.class_subject cs on cs.subject_id = sb.id join public.section s on s.class_id = cs.class_id where sb.course_id = c and s.id = v_sec limit 1;
  select avg(m.marks_obtained / a.max_marks) into it from public.mark m join public.assessment a on a.id = m.assessment_id join public.assessment_type t on t.id = a.assessment_type_id
   where m.student_id = k and a.subject_id = v_subj and a.section_id = v_sec and a.term = 1 and t.code = 'periodic_test';
  select sum(m.marks_obtained) / sum(a.max_marks) into mid from public.mark m join public.assessment a on a.id = m.assessment_id join public.assessment_type t on t.id = a.assessment_type_id
   where m.student_id = k and a.subject_id = v_subj and a.section_id = v_sec and a.term = 1 and t.code = 'half_yearly';
  select sum(m.marks_obtained) / sum(a.max_marks) into ese from public.mark m join public.assessment a on a.id = m.assessment_id join public.assessment_type t on t.id = a.assessment_type_id
   where m.student_id = k and a.subject_id = v_subj and a.section_id = v_sec and a.term = 1 and t.code = 'annual';
  v_cia := round(coalesce(it, 0) * 20 + coalesce(mid, 0) * 20, 2); v_ese := round(ese * 60, 2);
  if abs(r.cia - v_cia) > 0.02 or abs(r.ese - v_ese) > 0.02 then raise exception 'FAIL CIA % (expected %), ESE % (expected %)', r.cia, v_cia, r.ese, v_ese; end if;
  if r.passed <> (r.percent >= 40 and v_ese / 60 * 100 >= 40) then raise exception 'FAIL pass rule: %', r; end if;
  if not r.passed and (r.grade <> 'F' or r.point <> 0) then raise exception 'FAIL a failed course has a grade'; end if;

  -- a missing internal mark makes the course incomplete (not 0)
  select x.student_id into k2 from public.compute_course_results(v_sem, v_sec) x where x.student_id <> k and x.course_id = c and x.status in ('pass', 'fail') limit 1;
  delete from public.mark m using public.assessment a, public.assessment_type t
   where m.assessment_id = a.id and t.id = a.assessment_type_id and m.student_id = k2 and a.subject_id = v_subj and a.term = 1 and t.code = 'periodic_test'
     and m.id = (select m2.id from public.mark m2 join public.assessment a2 on a2.id = m2.assessment_id join public.assessment_type t2 on t2.id = a2.assessment_type_id
                 where m2.student_id = k2 and a2.subject_id = v_subj and a2.term = 1 and t2.code = 'periodic_test' limit 1);
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select x.status from public.compute_course_results(v_sem, v_sec) x where x.student_id = k2 and x.course_id = c) <> 'incomplete' then raise exception 'FAIL missing CIA mark not incomplete'; end if;
  reset role;

  -- publish
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.publish_semester_results(v_sem, v_sec);
  if n = 0 then raise exception 'FAIL nothing published'; end if;
  reset role;
  select round(sum(credits * point) / sum(credits), 2) into v_sgpa from public.course_result where semester_id = v_sem and student_id = k;
  if (select sgpa from public.semester_result where semester_id = v_sem and student_id = k) <> v_sgpa then raise exception 'FAIL SGPA'; end if;
  if (select cgpa from public.semester_result where semester_id = v_sem and student_id = k) <> v_sgpa then raise exception 'FAIL CGPA after one semester'; end if;
  if (select backlogs from public.semester_result where semester_id = v_sem and student_id = k) <> (select count(*) from public.course_result where semester_id = v_sem and student_id = k and not passed) then raise exception 'FAIL backlogs'; end if;
  -- results cannot be written by users
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin update public.course_result set point = 10 where student_id = k; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL result edited'; end if;
  reset role;
  -- the public check
  select verify_token into v_tok from public.semester_result where semester_id = v_sem and student_id = k;
  set local role anon;
  if (select sgpa from public.verify_grade_card(v_tok)) <> v_sgpa then raise exception 'FAIL verify'; end if;
  reset role;
  if exists (select 1 from public.semester_result where semester_id = v_sem and student_id = k2) then raise exception 'FAIL incomplete student published'; end if;
  -- marks behind a published result are locked
  ok := false; begin update public.mark m set marks_obtained = marks_obtained from public.assessment a
    where a.id = m.assessment_id and m.student_id = k and a.subject_id = v_subj and a.term = 1; exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL published marks editable'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- republishing leaves published students alone unless revised with a reason
  if public.publish_semester_results(v_sem, v_sec) <> 0 then raise exception 'FAIL republish changed results'; end if;
  if public.publish_semester_results(v_sem, v_sec, 'QA correction') <> n then raise exception 'FAIL revise'; end if;
  reset role;
  if (select count(*) from public.course_result_revision where reason = 'QA correction') = 0 then raise exception 'FAIL old results not kept'; end if;
  -- held back: hidden from the public check
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.withhold_result(v_sem, k, 'Fees overdue');
  reset role;
  set local role anon;
  if exists (select 1 from public.verify_grade_card(v_tok)) then raise exception 'FAIL withheld result verifies'; end if;
  reset role;
end $$;
rollback;
