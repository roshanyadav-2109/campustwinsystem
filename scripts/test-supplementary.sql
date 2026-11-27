-- Self-test for 0155 on Meridian (11): backlogs, supplementary registration,
-- fee, marks, publishing, grade cap, CGPA. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); te uuid := gen_random_uuid(); v_coe bigint; v_t bigint; v_sem bigint; v_sec bigint; v_sess bigint; v_type bigint;
  n int; k1 bigint; c1 bigint; k2 bigint; c2 bigint; r1 bigint; r2 bigint; v_sgpa numeric; v_cgpa_before numeric; v_cgpa_after numeric; v_stand_before numeric; v_stand_after numeric; su uuid := gen_random_uuid(); r3 bigint; v_inv bigint; v_amt2 numeric; v_card record; ok boolean; v_cnt int; v_amt numeric;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-supp-coe@example.com', 'authenticated', 'authenticated'), (te, 'qa-supp-t@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA CoE', 'qa-supp-coe@example.com', 'subject_teacher') returning id into v_coe;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Lecturer', 'qa-supp-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA CoE', 11, v_coe), (te, 'staff', 'QA Lecturer', 11, v_t);
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_coe, id from public.position_title where school_id = 11 and access_type = 'exams_head' and scope_level in ('campus', 'university') limit 1;
  select id into v_sem from public.semester where school_id = 11 and kind = 'odd' order by starts_on desc limit 1;
  select e.section_id into v_sec from public.course_registration r join public.student_enrollment e on e.student_id = r.student_id and e.status = 'active'
   where r.semester_id = v_sem group by e.section_id order by count(*) desc limit 1;
  select id into v_type from public.assessment_type where school_id = 11 and code = 'annual';

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.publish_semester_results(v_sem, v_sec);
  if not exists (select 1 from public.semester_backlogs(v_sem)) then raise exception 'FAIL no backlogs after publishing'; end if;
  select student_id, course_id into k1, c1 from public.semester_backlogs(v_sem) order by student_id, course_id limit 1;
  select student_id, course_id into k2, c2 from public.semester_backlogs(v_sem) where (student_id, course_id) <> (k1, c1) order by student_id, course_id limit 1;
  if not exists (select 1 from public.student_backlogs(k1) where course_id = c1) then raise exception 'FAIL student backlog'; end if;
  select sgpa, cgpa into v_sgpa, v_cgpa_before from public.semester_result where semester_id = v_sem and student_id = k1;
  select cgpa into v_stand_before from public.student_standing(k1);

  insert into public.exam_session (academic_year_id, name, term, assessment_type_id, kind, for_semester_id, fee_per_course)
  select (select id from public.academic_year where school_id = 11 and is_current), 'QA Supplementary', 1, v_type, 'supplementary', v_sem, 500 from public.semester where id = v_sem returning id into v_sess;
  n := public.register_backlogs(v_sess);
  select count(*) into v_cnt from public.semester_backlogs(v_sem) b where b.student_id in (select e.student_id from public.student_enrollment e where e.section_id = v_sec);
  if n < v_cnt then raise exception 'FAIL registered % of % backlogs', n, v_cnt; end if;
  if public.register_backlogs(v_sess) <> 0 then raise exception 'FAIL registered twice'; end if;
  select i.amount into v_amt from public.supp_registration sr join public.fee_invoice i on i.id = sr.invoice_id where sr.session_id = v_sess and sr.student_id = k1 limit 1;
  if v_amt <> 500 * (select count(*) from public.supp_registration where session_id = v_sess and student_id = k1) then raise exception 'FAIL fee %', v_amt; end if;
  if (select attempt from public.supp_registration where session_id = v_sess and student_id = k1 and course_id = c1) <> 2 then raise exception 'FAIL attempt number'; end if;
  select sr.id, sr.invoice_id into r3, v_inv from public.supp_registration sr where sr.session_id = v_sess and sr.student_id = k1 and sr.course_id <> c1 limit 1;
  if r3 is not null then
    select amount into v_amt2 from public.fee_invoice where id = v_inv;
    perform public.withdraw_supp(r3);
    if (select amount from public.fee_invoice where id = v_inv) <> v_amt2 - 500 then raise exception 'FAIL fee after withdrawing'; end if;
  end if;
  reset role;
  delete from public.supp_registration where session_id = v_sess and student_id = k2 and course_id = c2;
  insert into auth.users (id, email, aud, role) values (su, 'qa-supp-stu@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, student_id) values (su, 'student', 'QA Student', 11, k2);
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.register_backlogs(v_sess, k2, c2) <> 1 then raise exception 'FAIL student could not apply'; end if;
  ok := false; begin perform public.register_backlogs(v_sess, k1, c1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL student applied for someone else'; end if;
  reset role;

  -- a lecturer is not the exam cell
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.register_backlogs(v_sess); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL lecturer registered candidates'; end if;
  reset role;

  -- marks: k1 passes well, k2 is absent; cap a supplementary pass at 6 points
  update public.eval_scheme set supp_max_point = 6 where id = (select p.eval_scheme_id from public.student_enrollment e join public.section sec on sec.id = e.section_id
    join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id where e.student_id = k1 and e.status = 'active' limit 1);
  select id into r1 from public.supp_registration where session_id = v_sess and student_id = k1 and course_id = c1;
  select id into r2 from public.supp_registration where session_id = v_sess and student_id = k2 and course_id = c2;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.save_supp_marks(array[r1, r2], array[95, null]::numeric[], array[false, true]) <> 2 then raise exception 'FAIL saving marks'; end if;
  n := public.publish_supplementary(v_sess);
  if n < 2 then raise exception 'FAIL published %', n; end if;
  reset role;
  if not (select passed from public.course_result where student_id = k1 and course_id = c1 and attempt = 2) then raise exception 'FAIL passing re-take not passed'; end if;
  select x.point, x.grade, x.scheme into v_card from (select cr.point, cr.grade, (select p.eval_scheme_id from public.student_enrollment e join public.section sec on sec.id = e.section_id
    join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id where e.student_id = k1 and e.status = 'active' limit 1) scheme
    from public.course_result cr where cr.student_id = k1 and cr.course_id = c1 and cr.attempt = 2) x;
  if v_card.point > 6 then raise exception 'FAIL grade cap'; end if;
  if (select point from public.eval_grade where scheme_id = v_card.scheme and grade = v_card.grade) > 6 then raise exception 'FAIL capped letter % still worth more than 6', v_card.grade; end if;
  if (select grade from public.course_result where student_id = k2 and course_id = c2 and attempt = 2) <> 'Ab' then raise exception 'FAIL absent grade'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  if exists (select 1 from public.student_backlogs(k1) where course_id = c1) then raise exception 'FAIL cleared backlog still listed'; end if;
  if not exists (select 1 from public.student_backlogs(k2) where course_id = c2) then raise exception 'FAIL absent backlog cleared'; end if;
  reset role;
  select cgpa into v_cgpa_after from public.semester_result where semester_id = v_sem and student_id = k1;
  if (select sgpa from public.semester_result where semester_id = v_sem and student_id = k1) <> v_sgpa then raise exception 'FAIL original SGPA changed'; end if;
  if v_cgpa_after <> v_cgpa_before then raise exception 'FAIL the published grade card CGPA changed'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  select cgpa into v_stand_after from public.student_standing(k1);
  reset role;
  if v_stand_after <= v_stand_before then raise exception 'FAIL current standing did not use the new attempt (% -> %)', v_stand_before, v_stand_after; end if;
end $$;
rollback;
