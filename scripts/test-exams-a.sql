-- Self-test for 0158 on Meridian (11): grace marks, rank list, percentage,
-- revaluation, improvement exams, consolidated data. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); su uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); v_coe bigint; v_sem bigint; v_sec bigint; v_type bigint; v_scheme bigint;
  n int; v_res record; v_req bigint; ok boolean; v_old numeric; v_sess bigint; k bigint; c bigint; r1 bigint; k2 bigint; c2 bigint; r2 bigint; v_stand numeric; v_stand2 numeric;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-ea-coe@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA CoE', 'qa-ea-coe@example.com', 'subject_teacher') returning id into v_coe;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA CoE', 11, v_coe);
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_coe, id from public.position_title where school_id = 11 and access_type = 'exams_head' and scope_level in ('campus', 'university') limit 1;
  select id into v_sem from public.semester where school_id = 11 and kind = 'odd' order by starts_on desc limit 1;
  select e.section_id into v_sec from public.course_registration r join public.student_enrollment e on e.student_id = r.student_id and e.status = 'active'
   where r.semester_id = v_sem group by e.section_id order by count(*) desc limit 1;
  select p.eval_scheme_id into v_scheme from public.section sec join public.class c on c.id = sec.class_id join public.programme p on p.id = c.programme_id where sec.id = v_sec;
  select id into v_type from public.assessment_type where school_id = 11 and code = 'annual';
  update public.eval_scheme set grace_per_course = 30, grace_total = 30 where id = v_scheme;
  update public.school set cgpa_pct_multiplier = 9.5, cgpa_pct_offset = 0, reval_fee = 300, retotal_fee = 100, reval_window_days = 15 where id = 11;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.publish_semester_results(v_sem, v_sec);
  reset role;
  -- grace: a near miss passes at the pass grade, recorded on the course
  if not exists (select 1 from public.course_result where semester_id = v_sem and grace is not null and passed) then raise exception 'FAIL no grace applied'; end if;
  if exists (select 1 from public.course_result where semester_id = v_sem and grace > 30) then raise exception 'FAIL grace above the limit'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  if not exists (select 1 from public.rank_list(v_sem)) then raise exception 'FAIL rank list empty'; end if;
  if exists (select 1 from public.rank_list(v_sem) x where exists (select 1 from public.course_result cr where cr.student_id = x.student_id and cr.semester_id = v_sem and cr.grace is not null)) then
    raise exception 'FAIL graced student ranked';
  end if;
  if public.cgpa_percent(8) <> 76 then raise exception 'FAIL percentage %', public.cgpa_percent(8); end if;
  reset role;

  -- revaluation by the student: fee first, then the exam cell revises
  select cr.* into v_res from public.course_result cr where cr.semester_id = v_sem and cr.passed and cr.grace is null and cr.ese < cr.ese_max - 6 order by cr.id limit 1;
  insert into auth.users (id, email, aud, role) values (su, 'qa-ea-stu@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, student_id) values (su, 'student', 'QA Student', 11, v_res.student_id);
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  v_req := public.request_revaluation(v_res.id, 'revaluation');
  ok := false; begin perform public.request_revaluation(v_res.id, 'revaluation'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL duplicate revaluation'; end if;
  reset role;
  if (select i.amount from public.reval_request r join public.fee_invoice i on i.id = r.invoice_id where r.id = v_req) is distinct from 300 then raise exception 'FAIL revaluation fee'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.decide_revaluation(v_req, v_res.ese + 6); exception when others then ok := sqlerrm like '%not paid%'; end;
  if not ok then raise exception 'FAIL decided before the fee was paid'; end if;
  reset role;
  update public.fee_invoice set status = 'paid', paid_amount = amount where id = (select invoice_id from public.reval_request where id = v_req);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.decide_revaluation(v_req, v_res.ese + 6, 'QA recount') <> 'revised' then raise exception 'FAIL revaluation'; end if;
  reset role;
  if (select ese from public.course_result where id = v_res.id) <> v_res.ese + 6 or (select percent from public.course_result where id = v_res.id) <= v_res.percent then raise exception 'FAIL regrade'; end if;
  if not exists (select 1 from public.course_result_revision where reason like 'Revaluation #%' and (old ->> 'id')::bigint = v_res.id) then raise exception 'FAIL old result not kept'; end if;

  -- improvement: a better attempt counts, a worse one does not
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id, kind, for_semester_id)
  select (select id from public.academic_year where school_id = 11 and is_current), 'QA Improvement', 1, v_type, 'improvement', v_sem returning id into v_sess;
  select cr.student_id, cr.course_id into k, c from public.course_result cr where cr.semester_id = v_sem and cr.passed and cr.counts and cr.point < 9 and cr.grace is null
    and cr.student_id <> v_res.student_id order by cr.id limit 1;
  select cr.student_id, cr.course_id into k2, c2 from public.course_result cr where cr.semester_id = v_sem and cr.passed and cr.counts and cr.point >= 7 and cr.grace is null
    and cr.student_id not in (k, v_res.student_id) order by cr.id limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  select cgpa into v_stand from public.student_standing(k);
  select cgpa into v_stand2 from public.student_standing(k2);
  if public.register_backlogs(v_sess, k, c) <> 1 or public.register_backlogs(v_sess, k2, c2) <> 1 then raise exception 'FAIL improvement registration'; end if;
  ok := false; begin perform public.register_backlogs(v_sess, null, null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL improvement registered everyone'; end if;
  select id into r1 from public.supp_registration where session_id = v_sess and student_id = k;
  select id into r2 from public.supp_registration where session_id = v_sess and student_id = k2;
  perform public.save_supp_marks(array[r1, r2], array[100, 5]::numeric[], array[false, false]);
  perform public.publish_supplementary(v_sess);
  if not (select counts from public.course_result where student_id = k and course_id = c and kind = 'improvement') then raise exception 'FAIL better improvement not counted'; end if;
  if (select counts from public.course_result where student_id = k2 and course_id = c2 and kind = 'improvement') then raise exception 'FAIL worse improvement counted'; end if;
  if (select cgpa from public.student_standing(k)) <= v_stand then raise exception 'FAIL standing did not improve'; end if;
  if (select cgpa from public.student_standing(k2)) <> v_stand2 then raise exception 'FAIL a worse improvement changed the standing'; end if;
  if exists (select 1 from public.student_backlogs(k2) where course_id = c2) then raise exception 'FAIL a worse improvement made a backlog'; end if;
  if not exists (select 1 from public.student_supp_results(k) where kind = 'improvement') then raise exception 'FAIL improvement memo data'; end if;
  if not exists (select 1 from public.student_consolidated(k) where course_code is not null) then raise exception 'FAIL consolidated'; end if;
  reset role;
end $$;
rollback;
