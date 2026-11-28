-- Self-test for 0180 on Meridian (11): rooms by rows and benches, seat labels, booklets, scribes,
-- leave and duty swaps, remuneration, photocopies, supplementary results imported. Rolled back.
begin;
do $$ declare u uuid := gen_random_uuid(); v_coe bigint; v_t bigint; v_sem record; v_class bigint; v_type bigint; v_sess bigint; v_subj bigint;
  v_paper bigint; n int; ok boolean; r record; v_seat bigint; v_stu bigint; v_duty bigint; d date := (now() at time zone 'Asia/Kolkata')::date + 10; v_res bigint; v_req bigint;
  v_adm text; v_code text; v_att int; v_key text;
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

  -- a failed result to work with
  select e.student_id into v_stu from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current where e.school_id = 11 and e.status = 'active' limit 1;
  select st.admission_no into v_adm from public.student st where st.id = v_stu;
  select id, code into v_res, v_code from public.course where school_id = 11 limit 1;
  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, grade, point, passed)
  values (11, (select id from public.semester where school_id = 11 order by starts_on desc limit 1), v_stu, v_res, 1, 3, 'F', 0, false) returning id into v_res;
  -- a photocopy: a file outside the student's own folder is refused; the right one is accepted
  v_key := public.tenant_prefix(11) || '/students/' || v_stu || '/scripts/' || gen_random_uuid() || '.pdf';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  v_req := public.request_revaluation(v_res, 'photocopy');
  reset role;
  update public.fee_invoice set status = 'paid' where id = (select invoice_id from public.reval_request where id = v_req);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.supply_photocopy(v_req, 'schools/other/students/1/scripts/00000000-0000-0000-0000-000000000000.pdf'); exception when others then ok := sqlerrm like '%Bad file%'; end;
  if not ok then raise exception 'FAIL a file outside the folder was accepted'; end if;
  perform public.supply_photocopy(v_req, v_key);
  reset role;
  if (select status from public.reval_request where id = v_req) <> 'supplied' then raise exception 'FAIL photocopy'; end if;
  -- supplementary from the university: a new attempt once; the same file again adds nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); set local role authenticated;
  n := public.import_university_results((select semester_id from public.course_result where id = v_res), jsonb_build_array(jsonb_build_object('admission_no', v_adm, 'course_code', v_code, 'grade', 'AB')), 'supplementary');
  if n <> 1 then raise exception 'FAIL supplementary import %', n; end if;
  n := public.import_university_results((select semester_id from public.course_result where id = v_res), jsonb_build_array(jsonb_build_object('admission_no', v_adm, 'course_code', v_code, 'grade', 'AB')), 'supplementary');
  if n <> 0 then raise exception 'FAIL the same supplementary result added twice'; end if;
  reset role;
end $$;
rollback;
