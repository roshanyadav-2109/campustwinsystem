-- Self-test for 0162 on Meridian (11). Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); te uuid := gen_random_uuid(); pr uuid := gen_random_uuid(); of uuid := gen_random_uuid();
  v_coe bigint; v_t bigint; v_pr bigint; v_off bigint; v_sem record; v_sec bigint; v_type bigint; v_sess bigint; r1 bigint; ok boolean; v_reg bigint; v_req bigint; k bigint; v_subj bigint;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-c-coe@example.com', 'authenticated', 'authenticated'), (te, 'qa-c-t@example.com', 'authenticated', 'authenticated'),
    (pr, 'qa-c-pr@example.com', 'authenticated', 'authenticated'), (of, 'qa-c-of@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA CoE', 'qa-c-coe@example.com', 'subject_teacher') returning id into v_coe;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Lecturer', 'qa-c-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Head', 'qa-c-pr@example.com', 'principal') returning id into v_pr;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-c-of@example.com', 'office') returning id into v_off;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA CoE', 11, v_coe), (te, 'staff', 'QA Lecturer', 11, v_t), (pr, 'staff', 'QA Head', 11, v_pr), (of, 'staff', 'QA Office', 11, v_off);
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_coe, id from public.position_title where school_id = 11 and access_type = 'exams_head' and scope_level in ('campus', 'university') limit 1;
  select * into v_sem from public.semester where school_id = 11 and kind = 'odd' order by starts_on desc limit 1;
  select e.section_id into v_sec from public.course_registration r join public.student_enrollment e on e.student_id = r.student_id and e.status = 'active'
   where r.semester_id = v_sem.id group by e.section_id order by count(*) desc limit 1;
  select id into v_type from public.assessment_type where school_id = 11 and code = 'annual';

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.publish_semester_results(v_sem.id, v_sec);
  if (select count(*) from public.semester_result where semester_id = v_sem.id) = 0 then raise exception 'FAIL exam cell cannot see results'; end if;
  reset role;
  -- 1. a lecturer with no link to these students sees none of their results
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if (select count(*) from public.semester_result where semester_id = v_sem.id) <> 0 then raise exception 'FAIL an unrelated lecturer reads results'; end if;
  reset role;
  -- 3. the cut-off must be inside the semester
  perform set_config('request.jwt.claims', json_build_object('sub', pr, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.set_attendance_rules('cutoff', 3, 75, null, false, '{"attendance": ["head"], "fees": ["office"], "unlock": ["head"]}'::jsonb, date '2001-01-01'); exception when others then ok := sqlerrm like '%within the current semester%'; end;
  if not ok then raise exception 'FAIL cut-off outside the semester accepted'; end if;
  reset role;

  -- 5. correct a published supplementary result
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id, kind, for_semester_id)
  select (select id from public.academic_year where school_id = 11 and is_current), 'QA Supp C', 1, v_type, 'supplementary', v_sem.id returning id into v_sess;
  perform public.register_backlogs(v_sess);
  select id into r1 from public.supp_registration where session_id = v_sess order by id limit 1;
  perform public.save_supp_marks(array[r1], array[10]::numeric[], array[false]);
  perform public.publish_supplementary(v_sess);
  perform public.correct_supp_result(r1, 95, false, 'QA marks keyed wrongly');
  reset role;
  if not (select cr.passed from public.supp_registration sr join public.course_result cr on cr.id = sr.result_id where sr.id = r1) then raise exception 'FAIL correction did not regrade'; end if;
  if not exists (select 1 from public.course_result_revision where reason like 'Correction: QA marks keyed wrongly%') then raise exception 'FAIL correction not kept on record'; end if;

  -- 6. reject a course choice with a reason
  select r.id into v_reg from public.course_registration r where r.semester_id = (select id from public.semester where school_id = 11 and is_current) limit 1;
  update public.course_registration set status = 'registered' where id = v_reg;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.reject_registrations((select semester_id from public.course_registration where id = v_reg), array[v_reg], 'QA no seats in the lab') <> 1 then raise exception 'FAIL reject'; end if;
  reset role;
  if (select status || ':' || drop_reason from public.course_registration where id = v_reg) <> 'dropped:QA no seats in the lab' then raise exception 'FAIL reject reason'; end if;

  -- 7. condonation fee on an approved attendance relaxation
  update public.school set condonation_fee = 250 where id = 11;
  select e.student_id into k from public.student_enrollment e where e.school_id = 11 and e.status = 'active' limit 1;
  select id into v_subj from public.subject where school_id = 11 limit 1;
  insert into public.relaxation_request (school_id, kind, semester_id, student_id, subject_id, reason, chain, requested_by)
  values (11, 'attendance', (select id from public.semester where school_id = 11 and is_current), k, v_subj, 'QA condonation fee', array['head'], of) returning id into v_req;
  perform set_config('request.jwt.claims', json_build_object('sub', pr, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.decide_relaxation(v_req, true) <> 'approved' then raise exception 'FAIL approve'; end if;
  reset role;
  if not exists (select 1 from public.fee_invoice where student_id = k and title like 'Attendance condonation fee:%#' || v_req and amount = 250) then raise exception 'FAIL condonation fee'; end if;
end $$;
rollback;
