-- Self-test for 0126 on Meridian (11): a course result against a hand
-- calculation, publishing, SGPA = credits x points / credits. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); v_staff bigint; v_sem bigint; v_sec bigint; r record; k bigint; c bigint; v_subj bigint;
  it numeric; v_tok text; mid numeric; ese numeric; v_cia numeric; v_ese numeric; n int; v_sgpa numeric; ok boolean; v_g bigint;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-res-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA RES', 'qa-res-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA RES', 11, v_staff);
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
end $$;
rollback;
