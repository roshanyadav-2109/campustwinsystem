-- Self-test for 0193 on Westbridge (university 2: campuses 14 North, 15 City): a common exam copied to City; central
-- administration names a City setter and a North moderator; the paper is sent back, then approved; City's exam cell
-- can open it only near the start (logged); scripts of both campuses allotted centrally to evaluators of the other
-- campus; an evaluator sees scripts from another campus. Rolled back.
begin;
do $$ declare cu uuid := gen_random_uuid(); su uuid := gen_random_uuid(); mu uuid := gen_random_uuid(); ou uuid := gen_random_uuid(); eu uuid := gen_random_uuid();
  v_ca bigint; v_set bigint; v_mod bigint; v_of bigint; v_ev bigint; v_sess bigint; v_paper bigint; v_copy bigint; v_cpaper bigint; v_qp bigint; j jsonb; n int; k text;
  v_s14 bigint[]; v_s15 bigint[];
begin
  insert into auth.users (id, email, aud, role) values (cu, 'qa-cp-c@example.com', 'authenticated', 'authenticated'), (su, 'qa-cp-s@example.com', 'authenticated', 'authenticated'),
    (mu, 'qa-cp-m@example.com', 'authenticated', 'authenticated'), (ou, 'qa-cp-o@example.com', 'authenticated', 'authenticated'), (eu, 'qa-cp-e@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (14, 'QA Central', 'qa-cp-c@example.com', 'office') returning id into v_ca;
  insert into public.profile (id, role, full_name, school_id, staff_id, university_id, active_campus_id) values (cu, 'staff', 'QA Central', 14, v_ca, 2, 14);
  insert into public.staff (school_id, full_name, email, role) values (15, 'QA Setter', 'qa-cp-s@example.com', 'subject_teacher') returning id into v_set;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (su, 'staff', 'QA Setter', 15, v_set);
  insert into public.staff (school_id, full_name, email, role) values (14, 'QA Moderator', 'qa-cp-m@example.com', 'subject_teacher') returning id into v_mod;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (mu, 'staff', 'QA Moderator', 14, v_mod);
  insert into public.staff (school_id, full_name, email, role) values (15, 'QA City Office', 'qa-cp-o@example.com', 'office') returning id into v_of;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (ou, 'staff', 'QA City Office', 15, v_of);
  insert into public.staff (school_id, full_name, email, role) values (15, 'QA Evaluator City', 'qa-cp-e@example.com', 'subject_teacher') returning id into v_ev;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (eu, 'staff', 'QA Evaluator City', 15, v_ev);

  -- a North exam with one paper in a subject both campuses teach; copied to City
  insert into public.subject (school_id, name, code) values (14, 'QA Common Subject', 'QACS'), (15, 'QA Common Subject', 'QACS');
  insert into public.exam_session (school_id, academic_year_id, name, term, assessment_type_id)
  select 14, (select id from public.academic_year where school_id = 14 and is_current), 'QA Common Exam', 1, t1.id
  from public.assessment_type t1 join public.assessment_type t2 on t2.school_id = 15 and t2.code = t1.code where t1.school_id = 14 limit 1 returning id into v_sess;
  insert into public.class (school_id, name, level, stage) select sc, 'QA Common Class', 99, (select stage from public.class where school_id = 14 limit 1) from unnest(array[14, 15]) sc;
  insert into public.exam_paper (school_id, session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks)
  values (14, v_sess, (select id from public.class where school_id = 14 and name = 'QA Common Class'), (select id from public.subject where school_id = 14 and code = 'QACS'), (now() at time zone 'Asia/Kolkata')::date + 5, '10:00', '13:00', 100) returning id into v_paper;
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.copy_exam_session(v_sess, 15);
  reset role;
  v_copy := (j ->> 'session_id')::bigint;
  select id into v_cpaper from public.exam_paper where session_id = v_copy and source_paper_id = v_paper;
  if v_cpaper is null then raise exception 'FAIL the copied paper does not remember its source'; end if;

  -- central administration names the setter (City) and moderator (North)
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true); set local role authenticated;
  v_qp := public.assign_question_setter(v_paper, v_set, v_mod, 60);
  begin perform public.assign_question_setter(v_cpaper, v_set, v_mod, 60); raise exception 'FAIL a copied paper got its own setter'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  if not exists (select 1 from public.notification where staff_id = v_set and title = 'Question paper to set') then raise exception 'FAIL the setter was not told'; end if;

  -- the setter sees it and submits
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  if not exists (select 1 from public.my_question_papers() where qp_id = v_qp and role = 'setter') then raise exception 'FAIL the setter does not see the paper'; end if;
  if public.question_paper_upload_ok(v_qp) is distinct from 14 then raise exception 'FAIL upload not allowed for the setter'; end if;
  begin perform public.submit_question_paper(v_qp, 'elsewhere/x.pdf'); raise exception 'FAIL a key outside the folder was accepted'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  k := public.tenant_prefix(14) || '/exams/question-papers/' || v_qp || '/qa.pdf';
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.submit_question_paper(v_qp, k);
  reset role;

  -- the moderator sends it back (a note is needed), the setter resubmits, the moderator approves
  perform set_config('request.jwt.claims', json_build_object('sub', mu, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.moderate_question_paper(v_qp, false, ''); raise exception 'FAIL sent back without a note'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.moderate_question_paper(v_qp, false, 'QA question 4 is ambiguous');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.submit_question_paper(v_qp, k);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', mu, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.moderate_question_paper(v_qp, true, null);
  reset role;
  if (select status from public.question_paper where id = v_qp) <> 'approved' then raise exception 'FAIL not approved'; end if;

  -- City's exam cell: closed two days ahead; open 30 minutes before the start; the opening is logged
  update public.exam_paper set exam_date = (now() at time zone 'Asia/Kolkata')::date + 2 where id = v_cpaper;
  perform set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.question_paper_key(v_qp, v_cpaper); raise exception 'FAIL opened two days early'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  update public.exam_paper set exam_date = (now() at time zone 'Asia/Kolkata')::date, starts_at = ((now() at time zone 'Asia/Kolkata') + interval '30 minutes')::time,
    ends_at = ((now() at time zone 'Asia/Kolkata') + interval '150 minutes')::time where id = v_cpaper;
  perform set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.question_paper_key(v_qp, v_cpaper) is distinct from k then raise exception 'FAIL City could not open the paper in time'; end if;
  if (select count(*) from public.session_question_papers(v_copy) where paper_id = v_cpaper and central and status = 'approved') <> 1 then raise exception 'FAIL City does not see the central paper state'; end if;
  reset role;
  if not exists (select 1 from public.question_paper_access where qp_id = v_qp and school_id = 15) then raise exception 'FAIL the opening was not logged'; end if;

  -- scripts at both campuses, allotted centrally to the other campus's evaluator
  select array_agg(id) into v_s14 from (select id from public.student where school_id = 14 and status = 'active' limit 3) a;
  select array_agg(id) into v_s15 from (select id from public.student where school_id = 15 and status = 'active' limit 3) a;
  insert into public.exam_script (school_id, paper_id, student_id, code) select 14, v_paper, x, 'QAN' || x from unnest(v_s14) x on conflict do nothing;
  insert into public.exam_script (school_id, paper_id, student_id, code) select 15, v_cpaper, x, 'QAC' || x from unnest(v_s15) x on conflict do nothing;
  update public.exam_script set evaluator_id = null, status = 'pending', is_absent = false, marks = null where paper_id in (v_paper, v_cpaper);
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true); set local role authenticated;
  n := public.central_allot(v_paper, array[v_mod, v_ev]);
  if (select unassigned from public.central_valuation(v_sess) where paper_id = v_paper) <> 0 then raise exception 'FAIL scripts left unassigned'; end if;
  reset role;
  if n < 2 then raise exception 'FAIL only % scripts allotted', n; end if;
  if exists (select 1 from public.exam_script x join public.staff s on s.id = x.evaluator_id where x.paper_id in (v_paper, v_cpaper) and s.school_id = x.school_id) then
    raise exception 'FAIL a script went to an evaluator of its own campus';
  end if;
  -- the City evaluator sees North's scripts (codes only) and marks one
  perform set_config('request.jwt.claims', json_build_object('sub', eu, 'role', 'authenticated')::text, true); set local role authenticated;
  if not exists (select 1 from public.my_scripts() where code like 'QAN%') then raise exception 'FAIL the evaluator does not see the other campus''s scripts'; end if;
  n := public.save_script_marks(array[(select id from public.my_scripts() where code like 'QAN%' limit 1)], array[1::numeric], array[false]);
  reset role;
  if n <> 1 then raise exception 'FAIL the marks were not saved'; end if;
  raise notice 'central papers ok';
end $$;
rollback;
