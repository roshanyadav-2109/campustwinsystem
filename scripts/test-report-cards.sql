-- Self-test for 0095 on Greenfield (8). Temporary office, parent and teacher
-- logins act through their own rules. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); te uuid := gen_random_uuid();
  v_staff bigint; v_teacher bigint; v_year bigint; v_sec bigint; v_sec2 bigint; v_class bigint; v_sch bigint; v_sch2 bigint; v_area bigint;
  v_kid bigint; v_g bigint; v_subj bigint; v_pt numeric; v_pt_max numeric; v_hy numeric; v_hy_max numeric; v_expect numeric; r jsonb; s jsonb;
  n int; ok boolean; v_card bigint; v_token text; v_mark bigint; v_other_kid bigint; t_pt bigint; t_hy bigint; v_hy_mark bigint; v_assess bigint; v_foreign bigint;
begin
  select id into v_year from public.academic_year where school_id = 8 and is_current;
  select id into t_pt from public.assessment_type where school_id = 8 and code = 'periodic_test';
  select id into t_hy from public.assessment_type where school_id = 8 and code = 'half_yearly';
  select id into v_foreign from public.report_scheme where school_id <> 8 limit 1;
  -- a class with two sections, level 6
  select sec.class_id, min(sec.id), max(sec.id) into v_class, v_sec, v_sec2 from public.section sec join public.class c on c.id = sec.class_id
   where sec.school_id = 8 and c.level = 6 group by sec.class_id having count(*) >= 2 limit 1;
  if v_sec2 is null or v_sec2 = v_sec then
    select sec.class_id, sec.id into v_class, v_sec from public.section sec join public.class c on c.id = sec.class_id where sec.school_id = 8 and c.level = 6 limit 1;
    insert into public.section (class_id, name, school_id) values (v_class, 'QZ', 8) returning id into v_sec2;
  end if;
  insert into auth.users (id, email, aud, role) values (of, 'qa-rc-office@example.com', 'authenticated', 'authenticated'),
    (pa, 'qa-rc-parent@example.com', 'authenticated', 'authenticated'), (te, 'qa-rc-teacher@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA RC Office', 'qa-rc-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA RC Office', 8, v_staff);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA RC Teacher', 'qa-rc-teacher@example.com', 'subject_teacher') returning id into v_teacher;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (te, 'staff', 'QA RC Teacher', 8, v_teacher);

  -- office sets up a scheme: term 1 = periodic test best of 1 scaled to 20 + half-yearly scaled to 80
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.report_scheme (name, board, pass_percent) values ('QA Board A', 'Board A', 33) returning id into v_sch;
  insert into public.report_scheme_term (scheme_id, term, name) values (v_sch, 1, 'Term 1'), (v_sch, 2, 'Term 2');
  insert into public.report_scheme_component (scheme_id, term, name, assessment_type_id, rule, best_n, out_of, sort) values
    (v_sch, 1, 'Periodic test', t_pt, 'best', 1, 20, 1), (v_sch, 1, 'Half-yearly', t_hy, 'sum', null, 80, 2), (v_sch, 2, 'Periodic test', t_pt, 'best', 1, 100, 1);
  insert into public.report_grade_band (scheme_id, min_percent, grade, grade_point) values (v_sch, 90, 'A', 10), (v_sch, 75, 'B', 8), (v_sch, 50, 'C', 6), (v_sch, 33, 'D', 4), (v_sch, 0, 'E', 0);
  insert into public.report_coscholastic_area (scheme_id, name, grades) values (v_sch, 'Art', '{A,B,C}') returning id into v_area;
  insert into public.report_scheme (name, board) values ('QA Board B', 'Board B') returning id into v_sch2;
  insert into public.report_scheme_term (scheme_id, term, name) values (v_sch2, 1, 'Semester 1');
  insert into public.report_scheme_component (scheme_id, term, name, assessment_type_id, rule, out_of) values (v_sch2, 1, 'Exam', t_hy, 'sum', 100);
  insert into public.report_scheme_assignment (academic_year_id, class_id, scheme_id) values (v_year, v_class, v_sch);
  insert into public.report_scheme_assignment (academic_year_id, class_id, section_id, scheme_id) values (v_year, v_class, v_sec2, v_sch2);
  if public.report_scheme_for(v_sec, v_year) <> v_sch or public.report_scheme_for(v_sec2, v_year) <> v_sch2 then raise exception 'FAIL section scheme override'; end if;

  -- a student and one subject: compare with a hand calculation
  select m.student_id, a.subject_id into v_kid, v_subj from public.mark m join public.assessment a on a.id = m.assessment_id
   where a.section_id = v_sec and a.term = 1 and a.assessment_type_id = t_hy and m.marks_obtained is not null and not m.is_absent limit 1;
  select m.marks_obtained, a.max_marks into v_pt, v_pt_max from public.mark m join public.assessment a on a.id = m.assessment_id
   where m.student_id = v_kid and a.subject_id = v_subj and a.section_id = v_sec and a.term = 1 and a.assessment_type_id = t_pt limit 1;
  select m.marks_obtained, a.max_marks into v_hy, v_hy_max from public.mark m join public.assessment a on a.id = m.assessment_id
   where m.student_id = v_kid and a.subject_id = v_subj and a.section_id = v_sec and a.term = 1 and a.assessment_type_id = t_hy limit 1;
  v_expect := round(coalesce(v_pt / v_pt_max, 0) * 20 + v_hy / v_hy_max * 80, 2);
  select c.report into r from public.compute_report(v_sec, v_year, 1::smallint) c where c.student_id = v_kid;
  select x into s from jsonb_array_elements(r -> 'subjects') x where (x ->> 'subject_id')::bigint = v_subj;
  if abs((s ->> 'total')::numeric - v_expect) > 0.02 then raise exception 'FAIL total % expected %', s ->> 'total', v_expect; end if;
  if (s ->> 'max')::numeric <> 100 then raise exception 'FAIL max %', s ->> 'max'; end if;
  if s ->> 'grade' <> (select grade from public.report_grade_band where scheme_id = v_sch and min_percent <= (s ->> 'percent')::numeric order by min_percent desc limit 1) then raise exception 'FAIL grade'; end if;
  if r -> 'scheme' ->> 'name' <> 'QA Board A' then raise exception 'FAIL scheme name'; end if;
  -- the other section is computed with its own scheme
  select c.report into r from public.compute_report(v_sec2, v_year, 1::smallint) c limit 1;
  if r is not null and r -> 'scheme' ->> 'name' <> 'QA Board B' then raise exception 'FAIL second section uses %', r -> 'scheme' ->> 'name'; end if;

  -- another institution's scheme cannot be changed from here
  if v_foreign is not null then
    ok := false; begin insert into public.report_grade_band (scheme_id, min_percent, grade) values (v_foreign, 1, 'X'); exception when others then ok := true; end;
    if not ok then raise exception 'FAIL wrote into another institution''s scheme'; end if;
  end if;
  -- a grade outside the area's grades is refused
  ok := false; begin insert into public.report_coscholastic_grade (academic_year_id, student_id, area_id, term, grade) values (v_year, v_kid, v_area, 1, 'Z'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL grade outside the scale accepted'; end if;
  -- exempt from the half-yearly: left out (max 20), not incomplete
  select m.id into v_hy_mark from public.mark m join public.assessment a on a.id = m.assessment_id where m.student_id = v_kid and a.subject_id = v_subj and a.section_id = v_sec and a.term = 1 and a.assessment_type_id = t_hy;
  reset role;
  update public.mark set is_exempt = true where id = v_hy_mark;
  set local role authenticated;
  select c.report into r from public.compute_report(v_sec, v_year, 1::smallint) c where c.student_id = v_kid;
  select x into s from jsonb_array_elements(r -> 'subjects') x where (x ->> 'subject_id')::bigint = v_subj;
  if (s ->> 'max')::numeric <> 20 or (s ->> 'incomplete')::boolean then raise exception 'FAIL exempt: %', s; end if;
  reset role;
  update public.mark set is_exempt = false where id = v_hy_mark;
  -- a mark not yet entered: the subject is flagged incomplete
  delete from public.mark where id = v_hy_mark;
  set local role authenticated;
  select c.report into r from public.compute_report(v_sec, v_year, 1::smallint) c where c.student_id = v_kid;
  select x into s from jsonb_array_elements(r -> 'subjects') x where (x ->> 'subject_id')::bigint = v_subj;
  if not (s ->> 'incomplete')::boolean or not (r ->> 'incomplete')::boolean then raise exception 'FAIL missing mark not flagged: %', s; end if;
  reset role;
  insert into public.mark (assessment_id, student_id, marks_obtained, school_id)
    select a.id, v_kid, v_hy, 8 from public.assessment a where a.subject_id = v_subj and a.section_id = v_sec and a.term = 1 and a.assessment_type_id = t_hy;
  set local role authenticated;

  -- co-scholastic grade and remark (office)
  insert into public.report_coscholastic_grade (academic_year_id, student_id, area_id, term, grade) values (v_year, v_kid, v_area, 1, 'A');
  insert into public.report_remark (academic_year_id, student_id, term, remark) values (v_year, v_kid, 1, 'Works hard.');

  -- publishing needs the term locked
  ok := false; begin perform public.publish_report_cards(v_sec, v_year, 1::smallint); exception when others then ok := sqlerrm like 'Lock the marks first%'; end;
  if not ok then raise exception 'FAIL published without lock'; end if;
  insert into public.report_lock (academic_year_id, section_id, term) values (v_year, v_sec, 1);
  -- locked: marks cannot change, even for the office
  select m.id into v_mark from public.mark m join public.assessment a on a.id = m.assessment_id where m.student_id = v_kid and a.term = 1 and a.section_id = v_sec limit 1;
  ok := false; begin update public.mark set marks_obtained = marks_obtained where id = v_mark; exception when others then ok := sqlerrm like '%locked%'; end;
  if not ok then raise exception 'FAIL locked marks changed'; end if;
  -- the exam itself cannot change in a locked term
  select a.id into v_assess from public.assessment a where a.section_id = v_sec and a.term = 1 limit 1;
  ok := false; begin update public.assessment set max_marks = max_marks + 1 where id = v_assess; exception when others then ok := sqlerrm like '%locked%'; end;
  if not ok then raise exception 'FAIL exam edited in a locked term'; end if;
  ok := false; begin delete from public.assessment where id = v_assess; exception when others then ok := sqlerrm like '%locked%'; end;
  if not ok then raise exception 'FAIL exam deleted in a locked term'; end if;
  n := public.publish_report_cards(v_sec, v_year, 1::smallint);
  if n < 1 then raise exception 'FAIL nothing published'; end if;
  select id, verify_token into v_card, v_token from public.report_card where student_id = v_kid and term = 1 and status = 'published';
  if (select snapshot -> 'coscholastic' -> 0 ->> 'grade' from public.report_card where id = v_card) <> 'A'
     or (select snapshot ->> 'remark' from public.report_card where id = v_card) <> 'Works hard.' then raise exception 'FAIL snapshot misses co-scholastic or remark'; end if;
  -- final result needs every term locked
  ok := false; begin perform public.publish_report_cards(v_sec, v_year, 0::smallint); exception when others then ok := sqlerrm like '%Term 2%'; end;
  if not ok then raise exception 'FAIL final published with term 2 open'; end if;
  -- cards cannot be edited; withdrawing needs a reason
  ok := false; begin update public.report_card set snapshot = '{}' where id = v_card; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL snapshot edited'; end if;
  -- publishing again replaces the old card (old one withdrawn)
  n := public.publish_report_cards(v_sec, v_year, 1::smallint, array[v_kid]);
  if (select count(*) from public.report_card where student_id = v_kid and term = 1) <> 2 or (select count(*) from public.report_card where student_id = v_kid and term = 1 and status = 'published') <> 1 then
    raise exception 'FAIL republish'; end if;
  select id, verify_token into v_card, v_token from public.report_card where student_id = v_kid and term = 1 and status = 'published';
  reset role;
  -- parents are told
  if not exists (select 1 from public.notification_outbox where event_key = 'result_published' and ref_id = v_card) then raise exception 'FAIL parents not queued'; end if;
  perform public.fan_out_notifications();
  if not exists (select 1 from public.notification where event_key = 'result_published' and student_id = v_kid and title like 'Report card: %, Term 1') then raise exception 'FAIL parents not told'; end if;

  -- a parent sees their own child's card only
  select gs.guardian_id into v_g from public.guardian_student gs where gs.student_id = v_kid limit 1;
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA RC Parent', 8, v_g);
  select e.student_id into v_other_kid from public.student_enrollment e where e.section_id = v_sec and e.student_id <> v_kid
    and not exists (select 1 from public.guardian_student gs where gs.student_id = e.student_id and gs.guardian_id = v_g) limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not exists (select 1 from public.report_card where id = v_card) then raise exception 'FAIL parent cannot see own child card'; end if;
  if exists (select 1 from public.report_card where student_id = v_other_kid) then raise exception 'FAIL parent sees another child card'; end if;
  ok := false; begin perform public.compute_report(v_sec, v_year, 1::smallint); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent computed the whole section'; end if;
  if exists (select 1 from public.report_remark) then raise exception 'FAIL parent reads remarks table'; end if;
  reset role;

  -- a teacher who is not the class teacher cannot publish or lock
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.publish_report_cards(v_sec, v_year, 1::smallint); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL non-class-teacher published'; end if;
  ok := false; begin insert into public.report_lock (academic_year_id, section_id, term) values (v_year, v_sec, 2); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL non-class-teacher locked'; end if;
  ok := false; begin insert into public.report_scheme (name) values ('hack'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL teacher created a scheme'; end if;
  reset role;

  -- the public check shows who and which term, not the marks
  set local role anon;
  if not (select valid from public.verify_report_card(v_token)) then raise exception 'FAIL verify'; end if;
  reset role;

  -- withdraw needs a reason (office)
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin update public.report_card set status = 'withdrawn' where id = v_card; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL withdrawn without reason'; end if;
  update public.report_card set status = 'withdrawn', withdrawn_reason = 'QA' where id = v_card;
  reset role;
  set local role anon;
  if (select valid from public.verify_report_card(v_token)) then raise exception 'FAIL withdrawn card still valid'; end if;
  reset role;
end $$;
rollback;
