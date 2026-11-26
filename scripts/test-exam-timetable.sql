-- Self-test for 0106 on Greenfield (8), class VI (two sections). Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); v_staff bigint; v_year bigint; v_type bigint; v_class bigint := 28;
  v_sess bigint; p1 bigint; p2 bigint; s1 bigint; s2 bigint; v_sec bigint; v_kid bigint; v_g bigint; v_other bigint; ok boolean; c int; r record; v_tok text;
begin
  select id into v_year from public.academic_year where school_id = 8 and is_current;
  select id into v_type from public.assessment_type where school_id = 8 and code = 'half_yearly';
  select id into s1 from public.subject where school_id = 8 order by id limit 1;
  select id into s2 from public.subject where school_id = 8 and id <> s1 order by id limit 1;
  select id into v_sec from public.section where class_id = v_class order by id limit 1;
  select e.student_id into v_kid from public.student_enrollment e where e.section_id = v_sec and e.academic_year_id = v_year
    and exists (select 1 from public.guardian_student gs where gs.student_id = e.student_id) limit 1;
  select guardian_id into v_g from public.guardian_student where student_id = v_kid limit 1;
  select e.student_id into v_other from public.student_enrollment e where e.section_id = v_sec and e.student_id <> v_kid
    and not exists (select 1 from public.guardian_student gs where gs.student_id = e.student_id and gs.guardian_id = v_g) limit 1;
  insert into auth.users (id, email, aud, role) values (of, 'qa-ex-office@example.com', 'authenticated', 'authenticated'), (pa, 'qa-ex-parent@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Ex Office', 'qa-ex-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Ex Office', 8, v_staff);
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA Ex Parent', 8, v_g);

  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id, withhold_fee_dues)
    values (v_year, 'QA Half-Yearly', 1, v_type, false) returning id into v_sess;
  insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks)
    values (v_sess, v_class, s1, '2026-12-10', '09:00', '12:00', 80) returning id into p1;
  -- the same class at an overlapping time is refused
  ok := false; begin insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks)
    values (v_sess, v_class, s2, '2026-12-10', '11:00', '13:00', 80); exception when others then ok := sqlerrm like '%clashes%'; end;
  if not ok then raise exception 'FAIL clash accepted'; end if;
  insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks)
    values (v_sess, v_class, s2, '2026-12-10', '13:00', '15:00', 80) returning id into p2;
  -- marks columns exist in every section of the class
  select count(*) into c from public.assessment where exam_paper_id in (p1, p2);
  if c <> 2 * (select count(*) from public.section where class_id = v_class) then raise exception 'FAIL % marks columns', c; end if;
  -- optional papers in the same group may share a slot
  insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks, optional_group, component)
    values (v_sess, v_class, s2, '2026-12-12', '09:00', '12:00', 80, 'Language', 'Oral');
  insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks, optional_group, component)
    values (v_sess, v_class, s1, '2026-12-12', '09:00', '12:00', 20, 'Language', 'Practical');
  -- a paper cannot move to another subject
  ok := false; begin update public.exam_paper set subject_id = s2 where id = p1; exception when others then ok := sqlerrm like '%cannot move%'; end;
  if not ok then raise exception 'FAIL paper moved to another subject'; end if;
  -- renaming the exam renames its marks columns (practical keeps its label)
  update public.exam_session set name = 'QA Half-Yearly Renamed' where id = v_sess;
  if exists (select 1 from public.assessment a join public.exam_paper p on p.id = a.exam_paper_id where p.session_id = v_sess and a.name not like 'QA Half-Yearly Renamed%') then raise exception 'FAIL rename not in step'; end if;
  if not exists (select 1 from public.assessment a join public.exam_paper p on p.id = a.exam_paper_id where p.session_id = v_sess and a.name = 'QA Half-Yearly Renamed (Practical)') then raise exception 'FAIL practical column name'; end if;
  -- a section added later gets the columns
  reset role;
  insert into public.section (class_id, name, school_id) values (v_class, 'QZ', 8);
  if (select count(*) from public.assessment a join public.section sec on sec.id = a.section_id where sec.name = 'QZ' and sec.class_id = v_class and a.exam_paper_id is not null) <> 4 then raise exception 'FAIL new section has no exam columns'; end if;
  set local role authenticated;
  -- moving the paper moves the columns
  update public.exam_paper set exam_date = '2026-12-11', max_marks = 70 where id = p1;
  if exists (select 1 from public.assessment where exam_paper_id = p1 and (assessed_on <> '2026-12-11' or max_marks <> 70)) then raise exception 'FAIL columns not in step'; end if;
  reset role;

  -- not published: the parent sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.exam_session where id = v_sess) or exists (select 1 from public.exam_paper where session_id = v_sess) then raise exception 'FAIL unpublished exam visible to parent'; end if;
  ok := false; begin perform public.prepare_admit_cards(v_sess, v_sec, v_kid); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL admit card before publishing'; end if;
  reset role;

  -- publish; withhold for overdue fees
  update public.exam_session set published_at = now(), withhold_fee_dues = true where id = v_sess;
  insert into public.fee_invoice (student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, school_id)
    values (v_kid, v_sec, v_year, 'QA overdue', 500, 0, '2026-11-01', 'due', 8);
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.exam_paper where session_id = v_sess) <> 4 then raise exception 'FAIL parent cannot see the date sheet'; end if;
  select * into r from public.prepare_admit_cards(v_sess, v_sec, v_kid);
  if not r.withheld or r.reason not like 'Fees overdue%' or r.verify_token is not null then raise exception 'FAIL not withheld: %', r; end if;
  reset role;
  delete from public.fee_invoice where student_id = v_kid and title = 'QA overdue';
  set local role authenticated;
  select * into r from public.prepare_admit_cards(v_sess, v_sec, v_kid);
  if r.withheld or r.verify_token is null then raise exception 'FAIL still withheld after paying'; end if;
  v_tok := r.verify_token;
  ok := false; begin perform public.prepare_admit_cards(v_sess, v_sec, v_other); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent printed another child''s admit card'; end if;
  ok := false; begin perform public.prepare_admit_cards(v_sess, v_sec); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent printed the whole section'; end if;
  reset role;

  -- the office prints the whole section
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into c from public.prepare_admit_cards(v_sess, v_sec);
  if c < 5 then raise exception 'FAIL section admit cards %', c; end if;
  -- a paper with marks cannot be removed
  reset role;
  insert into public.mark (assessment_id, student_id, marks_obtained, school_id) select a.id, v_kid, 50, 8 from public.assessment a where a.exam_paper_id = p2 and a.section_id = v_sec;
  set local role authenticated;
  ok := false; begin delete from public.exam_paper where id = p2; exception when others then ok := sqlerrm like '%Marks are already entered%'; end;
  if not ok then raise exception 'FAIL paper with marks removed'; end if;
  delete from public.exam_paper where id = p1;
  if exists (select 1 from public.assessment where exam_paper_id = p1) then raise exception 'FAIL columns left behind'; end if;
  reset role;

  set local role anon;
  if not (select valid from public.verify_admit_card(v_tok)) then raise exception 'FAIL verify admit card'; end if;
  reset role;
end $$;
rollback;
