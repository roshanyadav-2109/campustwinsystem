-- Self-test for 0131 on Meridian (11): lock modes, unlock and relaxation
-- chains, the floor, live holds and fee extensions. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); pr uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); v_off2 bigint; as_o2 text; v_off bigint; v_pr bigint; v_sem record; v_sec bigint; v_class bigint; k bigint; v_subj bigint;
  d date := (now() at time zone 'Asia/Kolkata')::date; v_req bigint; ok boolean; v_res text; v_sess bigint; v_type bigint; r record;
  as_off text; as_pr text;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-lock-office@example.com', 'authenticated', 'authenticated'), (pr, 'qa-lock-head@example.com', 'authenticated', 'authenticated'), (o2, 'qa-lock-office2@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-lock-office@example.com', 'office') returning id into v_off;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Head', 'qa-lock-head@example.com', 'principal') returning id into v_pr;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office 2', 'qa-lock-office2@example.com', 'office') returning id into v_off2;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 11, v_off), (pr, 'staff', 'QA Head', 11, v_pr), (o2, 'staff', 'QA Office 2', 11, v_off2);
  as_o2 := json_build_object('sub', o2, 'role', 'authenticated')::text;
  as_off := json_build_object('sub', of, 'role', 'authenticated')::text; as_pr := json_build_object('sub', pr, 'role', 'authenticated')::text;
  select * into v_sem from public.semester where school_id = 11 and is_current;
  update public.semester set starts_on = least(starts_on, d - 30), ends_on = greatest(ends_on, d + 30), attendance_cutoff = null where id = v_sem.id;
  update public.school set attendance_lock_mode = 'daily', attendance_edit_days = 3, condone_floor = 65, hold_results_fees = true,
    relax_chain = '{"attendance": ["office", "head"], "fees": ["office"], "unlock": ["head"]}' where id = 11;
  select r2.student_id, e.section_id into k, v_sec from public.course_registration r2 join public.student_enrollment e on e.student_id = r2.student_id and e.status = 'active'
   where r2.semester_id = v_sem.id and r2.status <> 'dropped' limit 1;
  select class_id into v_class from public.section where id = v_sec;
  select sb.id into v_subj from public.course_registration r2 join public.programme_course pc on pc.id = r2.programme_course_id join public.subject sb on sb.course_id = pc.course_id
   join public.class_subject cs on cs.subject_id = sb.id and cs.class_id = v_class where r2.student_id = k and r2.semester_id = v_sem.id limit 1;
  delete from public.attendance_record where student_id = k and subject_id = v_subj;

  perform set_config('request.jwt.claims', as_off, true); set local role authenticated;
  -- daily lock: 5 days back is locked, 1 day back is open
  ok := false; begin perform public.mark_lecture(v_sec, v_subj, d - 5, 3::smallint, array[k]); exception when others then ok := sqlerrm like 'Attendance locks%'; end;
  if not ok then raise exception 'FAIL daily lock'; end if;
  ok := false; begin insert into public.attendance_record (student_id, section_id, academic_year_id, on_date, period, subject_id, status, school_id)
    values (k, v_sec, v_sem.academic_year_id, d - 6, 3, v_subj, 'present', 11); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL direct lecture write allowed'; end if;
  perform public.mark_lecture(v_sec, v_subj, d - 1, 3::smallint, '{}');
  perform public.mark_lecture(v_sec, v_subj, d - 1, 3::smallint, array[k]);
  -- unlock: chain is head only, so the office cannot approve its own request
  v_req := public.request_relaxation('unlock', null, v_subj, v_sec, d - 5, null, 'Was on exam duty');
  ok := false; begin perform public.decide_relaxation(v_req, true); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL office approved an unlock meant for the head'; end if;
  reset role;
  if (select count(*) from public.attendance_change_log where section_id = v_sec and subject_id = v_subj and on_date = d - 1) <> 1 then raise exception 'FAIL change not logged'; end if;
  perform set_config('request.jwt.claims', as_pr, true); set local role authenticated;
  if public.decide_relaxation(v_req, true, 'ok') <> 'approved' then raise exception 'FAIL unlock'; end if;
  reset role;
  perform set_config('request.jwt.claims', as_off, true); set local role authenticated;
  perform public.mark_lecture(v_sec, v_subj, d - 5, 3::smallint, array[k]);
  perform public.mark_lecture(v_sec, v_subj, d - 2, 3::smallint, array[k]);
  -- cut-off mode: up to the cut-off is frozen, after it open
  reset role;
  update public.school set attendance_lock_mode = 'cutoff' where id = 11;
  update public.semester set attendance_cutoff = d - 3 where id = v_sem.id;
  perform set_config('request.jwt.claims', as_off, true); set local role authenticated;
  ok := false; begin perform public.mark_lecture(v_sec, v_subj, d - 4, 4::smallint, '{}'); exception when others then ok := sqlerrm like '%frozen for exams%'; end;
  if not ok then raise exception 'FAIL cut-off freeze'; end if;
  perform public.mark_lecture(v_sec, v_subj, d - 1, 4::smallint, '{}');
  -- shortage counts only up to the cut-off: absent on d-5, the only lecture before it (unlock still open)
  reset role;
  if public.attendance_shortage(k, v_sem.id) is null then raise exception 'FAIL shortage up to cut-off'; end if;
  perform set_config('request.jwt.claims', as_off, true); set local role authenticated;
  -- floor: 0% is below 65%, cannot be relaxed
  ok := false; begin perform public.request_relaxation('attendance', k, v_subj, null, null, null, 'Medical'); exception when others then ok := sqlerrm like '%cannot be relaxed%'; end;
  if not ok then raise exception 'FAIL floor'; end if;
  reset role;
  update public.school set condone_floor = null where id = 11;
  perform set_config('request.jwt.claims', as_off, true); set local role authenticated;
  v_req := public.request_relaxation('attendance', k, v_subj, null, null, null, 'Medical certificate');
  -- the person who asked cannot approve
  ok := false; begin perform public.decide_relaxation(v_req, true); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL self-approval'; end if;
  reset role;
  -- the principal cannot skip the office step
  perform set_config('request.jwt.claims', as_pr, true); set local role authenticated;
  ok := false; begin perform public.decide_relaxation(v_req, true); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL principal skipped a step'; end if;
  reset role;
  perform set_config('request.jwt.claims', as_o2, true); set local role authenticated;
  if public.decide_relaxation(v_req, true) <> 'next' then raise exception 'FAIL step 1'; end if;
  ok := false; begin perform public.decide_relaxation(v_req, true); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL office acted on the head step'; end if;
  reset role;
  perform set_config('request.jwt.claims', as_pr, true); set local role authenticated;
  if public.decide_relaxation(v_req, true) <> 'approved' then raise exception 'FAIL step 2'; end if;
  reset role;
  if public.attendance_shortage(k, v_sem.id) is not null then raise exception 'FAIL relaxed still short'; end if;
  if (select count(*) from public.relaxation_step where request_id = v_req) <> 2 then raise exception 'FAIL steps not recorded'; end if;
  -- fees: overdue holds the result live; an extension releases it
  insert into public.semester_result (school_id, semester_id, student_id, credits_registered, credits_earned, sgpa, cgpa, backlogs) values (11, v_sem.id, k, 20, 20, 8, 8, 0);
  insert into public.fee_invoice (student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, school_id)
  values (k, v_sec, v_sem.academic_year_id, 'QA fee', 1000, 0, d - 10, 'due', 11);
  if public.result_hold_reason(k, v_sem.id) is distinct from 'Fees overdue' then raise exception 'FAIL fee hold: %', public.result_hold_reason(k, v_sem.id); end if;
  perform set_config('request.jwt.claims', as_off, true); set local role authenticated;
  v_req := public.request_relaxation('fees', k, null, null, null, d + 15, 'Will pay after scholarship');
  reset role;
  perform set_config('request.jwt.claims', as_o2, true); set local role authenticated;
  if public.decide_relaxation(v_req, true) <> 'approved' then raise exception 'FAIL fee extension'; end if;
  reset role;
  if public.result_hold_reason(k, v_sem.id) is not null then raise exception 'FAIL extension did not release'; end if;
  -- hall ticket too
  select id into v_type from public.assessment_type where school_id = 11 and code = 'annual';
  perform set_config('request.jwt.claims', as_off, true); set local role authenticated;
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id, withhold_fee_dues) values (v_sem.academic_year_id, 'QA Lock Exam', 1, v_type, true) returning id into v_sess;
  select * into r from public.prepare_admit_cards(v_sess, v_sec, k);
  if r.withheld then raise exception 'FAIL hall ticket held after relaxations: %', r.reason; end if;
  -- withdrawing the fee extension brings the hold back
  perform public.revoke_relaxation(v_req, 'QA cheque bounced');
  select * into r from public.prepare_admit_cards(v_sess, v_sec, k);
  if not r.withheld then raise exception 'FAIL revoke did not re-hold'; end if;
  -- the office (exam cell) approves directly, logged
  v_req := public.request_relaxation('fees', k, null, null, null, d + 5, 'QA exam cell decision', true);
  select * into r from public.prepare_admit_cards(v_sess, v_sec, k);
  if r.withheld then raise exception 'FAIL override did not release'; end if;
  reset role;
  if (select as_type from public.relaxation_step where request_id = v_req) <> 'override' then raise exception 'FAIL override not logged'; end if;
  if (select count(*) from public.notification where school_id = 11 and event_key = 'relaxation_waiting' and created_at > now() - interval '1 minute') = 0 then raise exception 'FAIL approvers not told'; end if;
end $$;
rollback;
