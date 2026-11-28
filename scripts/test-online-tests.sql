-- Self-test for 0201 on Greenfield (8): a teacher sets a test (single, multi, true/false, number, short); the student
-- starts it and gets no answers; answers save; submitting marks the objective ones (with negative marking); the
-- teacher marks the short answer; nothing saves after the deadline; another section's student and a parent cannot
-- take it; the questions lock once started; answers stay hidden until the test closes. Rolled back.
begin;
do $$ declare tu uuid := gen_random_uuid(); su uuid := gen_random_uuid(); ou uuid := gen_random_uuid(); pu uuid := gen_random_uuid();
  v_t bigint; v_sec bigint; v_sub bigint; v_year bigint; v_stu bigint; v_other bigint; v_g bigint; v_test bigint; j jsonb; v_att bigint; q jsonb; v_ids bigint[]; v_score numeric;
begin
  select id into v_year from public.academic_year where school_id = 8 and is_current;
  select a.section_id, a.subject_id into v_sec, v_sub from public.teacher_allotment a where a.school_id = 8 and a.academic_year_id = v_year and not a.is_class_teacher limit 1;
  select student_id into v_stu from public.student_enrollment where section_id = v_sec and academic_year_id = v_year and status = 'active' limit 1;
  select e.student_id into v_other from public.student_enrollment e join public.section s on s.id = e.section_id where s.school_id = 8 and e.section_id <> v_sec and e.academic_year_id = v_year and e.status = 'active' limit 1;
  select guardian_id into v_g from public.guardian_student where student_id = v_stu limit 1;
  insert into auth.users (id, email, aud, role) values (tu, 'qa-ot-t@example.com', 'authenticated', 'authenticated'), (su, 'qa-ot-s@example.com', 'authenticated', 'authenticated'),
    (ou, 'qa-ot-o@example.com', 'authenticated', 'authenticated'), (pu, 'qa-ot-p@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Test Teacher', 'qa-ot-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (tu, 'staff', 'QA Test Teacher', 8, v_t);
  insert into public.teacher_allotment (school_id, staff_id, section_id, subject_id, academic_year_id, is_class_teacher) values (8, v_t, v_sec, v_sub, v_year, false);
  insert into public.profile (id, role, full_name, school_id, student_id) values (su, 'student', 'QA Student', 8, v_stu), (ou, 'student', 'QA Other Student', 8, v_other);
  if v_g is not null then insert into public.profile (id, role, full_name, school_id, guardian_id) values (pu, 'guardian', 'QA Parent', 8, v_g); end if;

  -- the teacher sets and publishes the test
  perform set_config('request.jwt.claims', json_build_object('sub', tu, 'role', 'authenticated')::text, true); set local role authenticated;
  v_test := public.save_test(null, jsonb_build_object('subject_id', v_sub, 'section_ids', jsonb_build_array(v_sec), 'title', 'QA Unit test', 'opens_at', now() - interval '1 hour', 'closes_at', now() + interval '1 day',
    'minutes', 30, 'attempts', 1, 'show_answers', 'after_close', 'questions', jsonb_build_array(
      jsonb_build_object('kind', 'single', 'prompt', 'QA 2+2?', 'options', jsonb_build_array('3', '4', '5'), 'answer', 1, 'marks', 2),
      jsonb_build_object('kind', 'multi', 'prompt', 'QA primes?', 'options', jsonb_build_array('2', '4', '5'), 'answer', jsonb_build_array(0, 2), 'marks', 2),
      jsonb_build_object('kind', 'truefalse', 'prompt', 'QA the sun is a star', 'answer', true, 'marks', 1),
      jsonb_build_object('kind', 'number', 'prompt', 'QA pi to 2 places', 'answer', jsonb_build_object('value', 3.14, 'tolerance', 0.005), 'marks', 1),
      jsonb_build_object('kind', 'single', 'prompt', 'QA capital of France', 'options', jsonb_build_array('Paris', 'Rome'), 'answer', 0, 'marks', 1, 'negative', 0.5),
      jsonb_build_object('kind', 'short', 'prompt', 'QA explain photosynthesis', 'marks', 3))));
  perform public.publish_test(v_test, true);
  reset role;

  -- another section's student, and a parent, cannot take it
  perform set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.start_test(v_test); raise exception 'FAIL another section took the test'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  if v_g is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', pu, 'role', 'authenticated')::text, true); set local role authenticated;
    begin perform public.start_test(v_test); raise exception 'FAIL a parent took the test'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
    reset role;
  end if;

  -- the student starts: no answers in what they receive
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.start_test(v_test);
  v_att := (j ->> 'attempt')::bigint;
  if j::text ~ '"answer"' then raise exception 'FAIL the answers reached the student'; end if;
  reset role;
  select array_agg((x ->> 'id')::bigint order by (select seq from public.test_question where id = (x ->> 'id')::bigint)) into v_ids from jsonb_array_elements(j -> 'questions') x;
  -- answers: all right except the capital (wrong: -0.5); a short answer written
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.save_test_answer(v_att, v_ids[1], '1'::jsonb);
  perform public.save_test_answer(v_att, v_ids[2], '[2, 0]'::jsonb);
  perform public.save_test_answer(v_att, v_ids[3], 'true'::jsonb);
  perform public.save_test_answer(v_att, v_ids[4], '3.141'::jsonb);
  perform public.save_test_answer(v_att, v_ids[5], '1'::jsonb);
  perform public.save_test_answer(v_att, v_ids[6], '"QA plants make food from light"'::jsonb);
  begin perform public.review_attempt(v_att); raise exception 'FAIL reviewed before submitting'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  j := public.submit_test(v_att);
  reset role;
  -- 2 + 2 + 1 + 1 - 0.5 = 5.5, the short answer still to mark
  if (j ->> 'score')::numeric <> 5.5 or (j ->> 'to_mark')::int <> 1 then raise exception 'FAIL marking: %', j; end if;
  -- answers stay hidden until the test closes
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  if (public.review_attempt(v_att) ->> 'answers_shown')::boolean then raise exception 'FAIL answers shown before the close'; end if;
  begin perform public.save_test_answer(v_att, v_ids[1], '0'::jsonb); raise exception 'FAIL changed after submitting'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.start_test(v_test); raise exception 'FAIL a second attempt'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  -- the teacher marks the short answer (2 of 3): 7.5; the questions are now locked
  perform set_config('request.jwt.claims', json_build_object('sub', tu, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.mark_short_answer(v_att, v_ids[6], 2);
  select score into v_score from public.test_results(v_test) where attempt_id = v_att;
  if v_score <> 7.5 then raise exception 'FAIL after marking: %', v_score; end if;
  if not (public.test_for_teacher(v_test) ->> 'locked')::boolean then raise exception 'FAIL questions not locked'; end if;
  reset role;
  -- nothing saves after the deadline (a second test, already past its time)
  update public.test_paper set attempts = 2 where id = v_test;
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  v_att := (public.start_test(v_test) ->> 'attempt')::bigint;
  reset role;
  update public.test_attempt set deadline = now() - interval '1 minute' where id = v_att;
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.save_test_answer(v_att, v_ids[1], '1'::jsonb); raise exception 'FAIL saved after the deadline'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  raise notice 'online tests ok';
end $$;
rollback;
