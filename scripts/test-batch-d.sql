-- Self-test for 0165-0167 on Meridian (11): seating, duties, coded scripts,
-- internal-marks sign-off, the exam cell dashboard. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); te uuid := gen_random_uuid(); v_coe bigint; v_t bigint; v_sem record; v_sec bigint; v_class bigint; v_type bigint; v_sess bigint; v_subj bigint;
  v_paper bigint; n int; v_need int; ok boolean; v_row record; v_ids bigint[]; v_odd record; v_osec bigint; d date := (now() at time zone 'Asia/Kolkata')::date + 10;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-d-coe@example.com', 'authenticated', 'authenticated'), (te, 'qa-d-t@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA CoE', 'qa-d-coe@example.com', 'subject_teacher') returning id into v_coe;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Evaluator', 'qa-d-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA CoE', 11, v_coe), (te, 'staff', 'QA Evaluator', 11, v_t);
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_coe, id from public.position_title where school_id = 11 and access_type = 'exams_head' and scope_level in ('campus', 'university') limit 1;
  select * into v_sem from public.semester where school_id = 11 and is_current;
  select id into v_type from public.assessment_type where school_id = 11 and code = 'annual';
  -- a class with registered students and a subject of its courses
  select sec.class_id, sb.id into v_class, v_subj from public.course_registration r join public.programme_course pc on pc.id = r.programme_course_id
    join public.subject sb on sb.course_id = pc.course_id and sb.school_id = 11
    join public.student_enrollment e on e.student_id = r.student_id and e.academic_year_id = v_sem.academic_year_id and e.status = 'active'
    join public.section sec on sec.id = e.section_id join public.class_subject cs on cs.class_id = sec.class_id and cs.subject_id = sb.id
   where r.semester_id = v_sem.id limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.exam_room (name, capacity, sort) values ('QA Hall A', 40, 1), ('QA Hall B', 40, 2);
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id) values (v_sem.academic_year_id, 'QA Seating Exam', case when v_sem.kind = 'odd' then 1 else 2 end, v_type) returning id into v_sess;
  insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks) values (v_sess, v_class, v_subj, d, '09:00', '12:00', 100) returning id into v_paper;
  reset role;
  select count(*) into v_need from public.slot_candidates(v_sess, d, '09:00');
  if v_need = 0 then raise exception 'FAIL no candidates for the slot'; end if;
  update public.exam_room set active = false where school_id = 11 and name not like 'QA Hall %';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  -- seating fits; too small rooms are refused
  if v_need <= 80 then
    n := public.generate_seating(v_sess);
    if n <> v_need then raise exception 'FAIL seated % of %', n, v_need; end if;
    if exists (select 1 from public.exam_seat x join public.exam_room rm on rm.id = x.room_id where x.session_id = v_sess and x.seat_no > rm.capacity) then raise exception 'FAIL room over capacity'; end if;
    -- duties: an invigilator for every room in use
    n := public.assign_duties(v_sess);
    if n <> (select count(distinct room_id) from public.exam_seat where session_id = v_sess) then raise exception 'FAIL duties % for % rooms', n, (select count(distinct room_id) from public.exam_seat where session_id = v_sess); end if;
  end if;
  update public.exam_room set capacity = 1 where name like 'QA Hall %';
  ok := false; begin perform public.generate_seating(v_sess); exception when others then ok := sqlerrm like '%rooms seat%'; end;
  if not ok and v_need > 2 then raise exception 'FAIL too small rooms accepted'; end if;

  -- coded scripts: the evaluator sees codes only; decoding writes the marks
  n := public.generate_scripts(v_paper);
  reset role;
  if n <> (select count(*) from public.paper_candidates(v_paper)) or n = 0 then raise exception 'FAIL scripts %', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.allot_evaluators(v_paper, array[v_t]);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if (select count(*) from public.exam_script) <> 0 then raise exception 'FAIL evaluator reads the script table (names)'; end if;
  select array_agg(id) into v_ids from public.my_scripts();
  if coalesce(cardinality(v_ids), 0) <> n then raise exception 'FAIL evaluator sees % scripts', cardinality(v_ids); end if;
  if public.save_script_marks(v_ids, array_fill(77::numeric, array[cardinality(v_ids)]), array_fill(false, array[cardinality(v_ids)])) <> n then raise exception 'FAIL saving script marks'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.decode_scripts(v_paper) <> n then raise exception 'FAIL decode'; end if;
  reset role;
  if (select count(*) from public.mark m join public.assessment a on a.id = m.assessment_id where a.exam_paper_id = v_paper and m.marks_obtained = 77) <> n then raise exception 'FAIL decoded marks not in the record'; end if;

  -- internal-marks sign-off holds publishing when required (on the odd semester, which has results to publish)
  select * into v_odd from public.semester where school_id = 11 and kind = 'odd' order by starts_on desc limit 1;
  select e.section_id into v_osec from public.course_registration r join public.student_enrollment e on e.student_id = r.student_id and e.status = 'active' where r.semester_id = v_odd.id limit 1;
  update public.school set require_cia_signoff = true where id = 11;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.publish_semester_results(v_odd.id, v_osec); exception when others then ok := sqlerrm like 'Internal marks are not signed off%'; end;
  if not ok then raise exception 'FAIL published without sign-off'; end if;
  for v_row in select * from public.cia_signoff_status(v_odd.id) x where x.section_id = v_osec loop perform public.sign_cia(v_odd.id, v_row.section_id, v_row.subject_id); end loop;
  if public.publish_semester_results(v_odd.id, v_osec) = 0 then raise exception 'FAIL publish after sign-off'; end if;
  if (public.exam_cell_overview() -> 'sessions') is null then raise exception 'FAIL dashboard'; end if;
  reset role;
end $$;
rollback;
