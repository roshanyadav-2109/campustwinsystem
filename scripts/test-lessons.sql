-- Self-test for 0199 on Greenfield (8): a subject's teacher saves the syllabus and logs a lesson with a topic and a
-- link; a parent of a student in that section sees the lesson, the topic covered and the child's attendance; a parent
-- in another section cannot; a teacher of another subject cannot log it; a future date is refused. Rolled back.
begin;
do $$ declare tu uuid := gen_random_uuid(); xu uuid := gen_random_uuid(); pu uuid := gen_random_uuid(); qu uuid := gen_random_uuid();
  v_t bigint; v_x bigint; v_sec bigint; v_sub bigint; v_cls bigint; v_other_sec bigint; v_stu bigint; v_ostu bigint; v_g bigint; v_og bigint; v_les bigint; v_top bigint; n int;
begin
  -- a section and subject of this year, a student there with a guardian, and a student of another section with a guardian
  select a.section_id, a.subject_id, s.class_id into v_sec, v_sub, v_cls from public.teacher_allotment a join public.section s on s.id = a.section_id
   where a.school_id = 8 and a.academic_year_id = (select id from public.academic_year where school_id = 8 and is_current) and not a.is_class_teacher limit 1;
  select gs.student_id, gs.guardian_id into v_stu, v_g from public.guardian_student gs join public.student_enrollment e on e.student_id = gs.student_id and e.status = 'active'
   where e.section_id = v_sec limit 1;
  select gs.student_id, gs.guardian_id, e.section_id into v_ostu, v_og, v_other_sec from public.guardian_student gs join public.student_enrollment e on e.student_id = gs.student_id and e.status = 'active'
   join public.section s on s.id = e.section_id where s.school_id = 8 and e.section_id <> v_sec and not exists (select 1 from public.guardian_student g2 join public.student_enrollment e2 on e2.student_id = g2.student_id and e2.status = 'active' where g2.guardian_id = gs.guardian_id and e2.section_id = v_sec) limit 1;
  if v_stu is null or v_ostu is null then raise exception 'SKIP no suitable students'; end if;

  insert into auth.users (id, email, aud, role) values (tu, 'qa-ls-t@example.com', 'authenticated', 'authenticated'), (xu, 'qa-ls-x@example.com', 'authenticated', 'authenticated'),
    (pu, 'qa-ls-p@example.com', 'authenticated', 'authenticated'), (qu, 'qa-ls-q@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Subject Teacher', 'qa-ls-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (tu, 'staff', 'QA Subject Teacher', 8, v_t);
  insert into public.teacher_allotment (school_id, staff_id, section_id, subject_id, academic_year_id, is_class_teacher)
    values (8, v_t, v_sec, v_sub, (select id from public.academic_year where school_id = 8 and is_current), false);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Other Teacher', 'qa-ls-x@example.com', 'subject_teacher') returning id into v_x;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (xu, 'staff', 'QA Other Teacher', 8, v_x);
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pu, 'guardian', 'QA Parent', 8, v_g), (qu, 'guardian', 'QA Other Parent', 8, v_og);

  -- the teacher saves the syllabus and logs today's lesson
  perform set_config('request.jwt.claims', json_build_object('sub', tu, 'role', 'authenticated')::text, true); set local role authenticated;
  n := public.save_syllabus(v_sub, v_cls, '[{"title":"QA Unit 1","topics":["QA Topic A","QA Topic B"]},{"title":"QA Unit 2","topics":["QA Topic C"]}]'::jsonb);
  if n <> 3 then raise exception 'FAIL syllabus saved % topics', n; end if;
  select t.id into v_top from public.syllabus_topic t join public.syllabus_unit u on u.id = t.unit_id where u.subject_id = v_sub and u.class_id = v_cls and t.title = 'QA Topic A';
  begin perform public.log_lesson(v_sec, v_sub, (now() at time zone 'Asia/Kolkata')::date + 1, 1::smallint, array[v_top], 'x'); raise exception 'FAIL a future lesson was logged'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  v_les := public.log_lesson(v_sec, v_sub, (now() at time zone 'Asia/Kolkata')::date, 1::smallint, array[v_top], 'QA introduced topic A', '[{"title":"QA notes","url":"https://example.com/notes"}]'::jsonb);
  -- logging the same lecture again updates it
  if public.log_lesson(v_sec, v_sub, (now() at time zone 'Asia/Kolkata')::date, 1::smallint, array[v_top], 'QA introduced topic A, with examples') <> v_les then raise exception 'FAIL the same lecture made a second log'; end if;
  reset role;

  -- a teacher of another subject cannot log it
  perform set_config('request.jwt.claims', json_build_object('sub', xu, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.log_lesson(v_sec, v_sub, (now() at time zone 'Asia/Kolkata')::date, 2::smallint, null, 'x'); raise exception 'FAIL another teacher logged it'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;

  -- the parent sees the lesson, the topic and the link, and topic A as covered (1 of 3)
  perform set_config('request.jwt.claims', json_build_object('sub', pu, 'role', 'authenticated')::text, true); set local role authenticated;
  if not exists (select 1 from public.lesson_feed(v_sec, v_sub, v_stu) f where f.id = v_les and f.summary like 'QA introduced topic A, with examples' and f.topics::text like '%QA Topic A%' and f.materials::text like '%QA notes%') then
    raise exception 'FAIL the parent does not see the lesson';
  end if;
  if (select count(*) from public.syllabus_progress(v_sec, v_sub) where covered_on is not null) <> 1 or (select count(*) from public.syllabus_progress(v_sec, v_sub)) <> 3 then raise exception 'FAIL progress'; end if;
  reset role;

  -- a parent in another section sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', qu, 'role', 'authenticated')::text, true); set local role authenticated;
  if exists (select 1 from public.lesson_feed(v_sec, v_sub, v_ostu)) or exists (select 1 from public.syllabus_progress(v_sec, v_sub)) then raise exception 'FAIL another section''s parent sees the lessons'; end if;
  reset role;
  raise notice 'lessons ok';
end $$;
rollback;
