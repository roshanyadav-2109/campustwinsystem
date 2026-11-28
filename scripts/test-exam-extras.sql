-- Self-test for 0180 on Meridian (11): rooms by rows and benches, seat labels, booklets, scribes,
-- leave and duty swaps, remuneration, photocopies, supplementary results imported. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); v_coe bigint; v_t bigint; v_sem record; v_class bigint; v_type bigint; v_sess bigint; v_subj bigint;
  v_paper bigint; n int; ok boolean; r record; v_seat bigint; v_stu bigint; v_duty bigint; d date := (now() at time zone 'Asia/Kolkata')::date + 10; v_res bigint; v_req bigint;
  v_adm text; v_code text; v_att int;
begin
  insert into auth.users (id, email, aud, role) values (u, 'qa-x-coe@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA CoE', 'qa-x-coe@example.com', 'subject_teacher') returning id into v_coe;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Spare', 'qa-x-sp@example.com', 'subject_teacher') returning id into v_t;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (u, 'staff', 'QA CoE', 11, v_coe);
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_coe, id from public.position_title where school_id = 11 and access_type = 'exams_head' and scope_level in ('campus', 'university') limit 1;
  select * into v_sem from public.semester where school_id = 11 and is_current;
  select id into v_type from public.assessment_type where school_id = 11 and code = 'annual';
  select sec.class_id, sb.id into v_class, v_subj from public.course_registration rg join public.programme_course pc on pc.id = rg.programme_course_id
    join public.subject sb on sb.course_id = pc.course_id and sb.school_id = 11
    join public.student_enrollment e on e.student_id = rg.student_id and e.academic_year_id = v_sem.academic_year_id and e.status = 'active'
    join public.section sec on sec.id = e.section_id join public.class_subject cs on cs.class_id = sec.class_id and cs.subject_id = sb.id
   where rg.semester_id = v_sem.id limit 1;
  update public.exam_room set active = false where school_id = 11;
  insert into public.exam_rate (school_id, kind, amount) values (11, 'duty', 300), (11, 'script', 25) on conflict (school_id, kind) do update set amount = excluded.amount;

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  -- a room of 10 rows x 4 benches, two to a bench: 80 seats
  insert into public.exam_room (name, capacity, sort, rows_n, benches_n, per_bench) values ('QA Bench Hall', 1, 1, 10, 4, 2);
  if (select capacity from public.exam_room where name = 'QA Bench Hall' and school_id = 11) <> 80 then raise exception 'FAIL capacity from rows and benches'; end if;
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id) values (v_sem.academic_year_id, 'QA Extras Exam', case when v_sem.kind = 'odd' then 1 else 2 end, v_type) returning id into v_sess;
  insert into public.exam_paper (session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks) values (v_sess, v_class, v_subj, d, '09:00', '12:00', 100) returning id into v_paper;
  n := public.generate_seating(v_sess);
  if n = 0 then raise exception 'FAIL nobody seated'; end if;
  select id, student_id into v_seat, v_stu from public.exam_seat where session_id = v_sess and seat_no = 2;
  if (select seat_label from public.exam_seat where id = v_seat) <> 'R1-B1B' then raise exception 'FAIL seat label %', (select seat_label from public.exam_seat where id = v_seat); end if;
  -- a scribe for one student shows on the roster
  insert into public.exam_accommodation (student_id, session_id, scribe, scribe_name, extra_minutes) values (v_stu, v_sess, true, 'QA Scribe', 20);
  -- the spare teacher is on leave: duties go to someone else
  reset role;
  insert into public.staff_leave (school_id, staff_id, academic_year_id, leave_type_id, from_date, to_date, days, reason, status)
  select 11, v_t, v_sem.academic_year_id, (select id from public.staff_leave_type where school_id = 11 limit 1), d, d, 1, 'QA', 'approved';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.assign_duties(v_sess);
  if exists (select 1 from public.exam_duty where session_id = v_sess and staff_id = v_t) then raise exception 'FAIL duty for a teacher on leave'; end if;
  select id into v_duty from public.exam_duty where session_id = v_sess limit 1;
  ok := false; begin perform public.swap_duty(v_duty, v_t); exception when others then ok := sqlerrm like '%on leave%'; end;
  if not ok then raise exception 'FAIL swap to a teacher on leave'; end if;
  perform public.swap_duty(v_duty, v_coe);
  -- booklets and late arrival
  perform public.save_booklets(array[v_seat], array['AB123456'], array[2], array[true]);
  select * into r from public.my_room_roster(v_sess, d, '09:00') x where x.seat_id = v_seat;
  if r.booklet_no <> 'AB123456' or not r.late or r.needs not like 'Scribe: QA Scribe%' or r.seat_label <> 'R1-B1B' then raise exception 'FAIL roster %', row_to_json(r); end if;
  -- remuneration: the CoE's swapped duty is paid
  select * into r from public.exam_remuneration(v_sess) x where x.staff_id = v_coe;
  if r.duties <> 1 or r.duty_amount <> 300 then raise exception 'FAIL remuneration %', row_to_json(r); end if;
  reset role;

  -- a photocopy of the answer script, asked for and supplied
  select cr.id, cr.student_id into v_res, v_stu from public.course_result cr where cr.school_id = 11 and cr.attempt = 1 and cr.grade <> 'Ab' limit 1;
  if v_res is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
    v_req := public.request_revaluation(v_res, 'photocopy');
    perform public.supply_photocopy(v_req, 'meridian/qa/photocopy.pdf');
    reset role;
    if (select status from public.reval_request where id = v_req) <> 'supplied' then raise exception 'FAIL photocopy'; end if;
  end if;

  -- supplementary results from the university: a new attempt; AB is absent; WH withholds the semester
  select cr.student_id, st.admission_no, c.code, cr.attempt into v_stu, v_adm, v_code, v_att from public.course_result cr join public.student st on st.id = cr.student_id join public.course c on c.id = cr.course_id
   where cr.school_id = 11 and cr.semester_id is not null order by cr.id limit 1;
  if v_stu is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
    n := public.import_university_results((select semester_id from public.course_result where student_id = v_stu and attempt = v_att order by id limit 1),
      jsonb_build_array(jsonb_build_object('admission_no', v_adm, 'course_code', v_code, 'grade', 'AB')), 'supplementary');
    reset role;
    if n <> 1 or not exists (select 1 from public.course_result cr join public.course c on c.id = cr.course_id where cr.student_id = v_stu and c.code = v_code and cr.kind = 'supplementary' and cr.grade = 'Ab' and not cr.passed and cr.attempt > v_att) then
      raise exception 'FAIL supplementary import';
    end if;
  end if;
end $$;
rollback;
