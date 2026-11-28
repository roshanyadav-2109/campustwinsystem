-- Self-test for 0200 on Meridian (11, a college): theory and practical parts, two lab batches in the same period under
-- different teachers (neither overwrites the other), a practical teacher cannot mark theory, a change needs a reason,
-- the per-part breakdown beside the compiled figure, a practical-only subject, a correction asked and accepted,
-- medical leave and on duty approved. Rolled back.
begin;
do $$ declare ou uuid := gen_random_uuid(); tu uuid := gen_random_uuid(); p1u uuid := gen_random_uuid(); p2u uuid := gen_random_uuid(); su uuid := gen_random_uuid();
  v_of bigint; v_t bigint; v_p1 bigint; v_p2 bigint; v_sec bigint; v_sub bigint; v_year bigint; v_roster bigint[]; v_b1 bigint[]; v_b2 bigint[]; v_stu bigint; n int; v_corr bigint; v_leave bigint;
  v_today date := (now() at time zone 'Asia/Kolkata')::date; v_held int; v_parts int; v_key text;
begin
  select academic_year_id into v_year from public.semester where school_id = 11 and is_current;
  select e.section_id into v_sec from public.student_enrollment e join public.section s on s.id = e.section_id
   where s.school_id = 11 and e.academic_year_id = v_year and e.status = 'active' group by e.section_id having count(*) >= 4 limit 1;
  select array_agg(student_id order by student_id) into v_roster from public.student_enrollment where section_id = v_sec and academic_year_id = v_year and status = 'active';
  v_b1 := v_roster[1:cardinality(v_roster) / 2]; v_b2 := v_roster[cardinality(v_roster) / 2 + 1:];
  v_stu := v_b1[1];
  -- a fresh subject with theory and practical (not an elective)
  insert into public.subject (school_id, name, code, components) values (11, 'QA Physics', 'QAPHY', '{theory,practical}') returning id into v_sub;
  insert into public.class_subject (school_id, class_id, subject_id) select 11, class_id, v_sub from public.section where id = v_sec;

  insert into auth.users (id, email, aud, role) values (ou, 'qa-ap-o@example.com', 'authenticated', 'authenticated'), (tu, 'qa-ap-t@example.com', 'authenticated', 'authenticated'),
    (p1u, 'qa-ap-p1@example.com', 'authenticated', 'authenticated'), (p2u, 'qa-ap-p2@example.com', 'authenticated', 'authenticated'), (su, 'qa-ap-s@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-ap-o@example.com', 'office') returning id into v_of;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Theory', 'qa-ap-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Lab B1', 'qa-ap-p1@example.com', 'subject_teacher') returning id into v_p1;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Lab B2', 'qa-ap-p2@example.com', 'subject_teacher') returning id into v_p2;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (ou, 'staff', 'QA Office', 11, v_of), (tu, 'staff', 'QA Theory', 11, v_t), (p1u, 'staff', 'QA Lab B1', 11, v_p1), (p2u, 'staff', 'QA Lab B2', 11, v_p2);
  insert into public.profile (id, role, full_name, school_id, student_id) values (su, 'student', 'QA Student', 11, v_stu);
  insert into public.teacher_allotment (school_id, staff_id, section_id, subject_id, academic_year_id, component) values (11, v_t, v_sec, v_sub, v_year, 'theory');
  insert into public.teacher_allotment (school_id, staff_id, section_id, subject_id, academic_year_id, component, batch) values (11, v_p1, v_sec, v_sub, v_year, 'practical', 'B1'), (11, v_p2, v_sec, v_sub, v_year, 'practical', 'B2');

  -- the office splits the section into lab batches
  perform set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.save_section_batches(v_sec, jsonb_build_array(jsonb_build_object('label', 'B1', 'students', to_jsonb(v_b1)), jsonb_build_object('label', 'B2', 'students', to_jsonb(v_b2))));
  reset role;

  -- both batches in the same period, by their own teachers: neither overwrites the other
  perform set_config('request.jwt.claims', json_build_object('sub', p1u, 'role', 'authenticated')::text, true); set local role authenticated;
  n := public.mark_lecture(v_sec, v_sub, v_today, 41::smallint, array[v_stu], 'practical', 'B1', null);
  if n <> cardinality(v_b1) then raise exception 'FAIL batch B1 marked % of %', n, cardinality(v_b1); end if;
  begin perform public.mark_lecture(v_sec, v_sub, v_today, 40::smallint, null, 'theory', null, null); raise exception 'FAIL a lab teacher marked theory'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.mark_lecture(v_sec, v_sub, v_today, 41::smallint, null, 'practical', 'B2', null); raise exception 'FAIL the B1 teacher marked B2'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p2u, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.mark_lecture(v_sec, v_sub, v_today, 41::smallint, null, 'practical', 'B2', null);
  reset role;
  if (select count(*) from public.attendance_record where section_id = v_sec and subject_id = v_sub and on_date = v_today and period = 41 and component = 'practical') <> cardinality(v_roster) then
    raise exception 'FAIL one batch wiped the other';
  end if;
  if (select status::text from public.attendance_record where student_id = v_stu and on_date = v_today and period = 41) <> 'absent' then raise exception 'FAIL B1''s absence was lost'; end if;

  -- changing B1 again needs a reason
  perform set_config('request.jwt.claims', json_build_object('sub', p1u, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.mark_lecture(v_sec, v_sub, v_today, 41::smallint, null, 'practical', 'B1', null); raise exception 'FAIL a change without a reason'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.mark_lecture(v_sec, v_sub, v_today, 41::smallint, null, 'practical', 'B1', 'QA came late from the library, was present');
  perform public.mark_lecture(v_sec, v_sub, v_today, 41::smallint, array[v_stu], 'practical', 'B1', 'QA re-checked: absent');
  reset role;
  if not exists (select 1 from public.attendance_change_log where subject_id = v_sub and period = 41 and reason like 'QA came late%') then raise exception 'FAIL the reason was not kept'; end if;

  -- theory by the theory teacher
  perform set_config('request.jwt.claims', json_build_object('sub', tu, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.mark_lecture(v_sec, v_sub, v_today, 40::smallint, null, 'theory', null, null);
  reset role;
  -- parts: theory and practical for the student; compiled = both together
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into v_parts from public.course_attendance_parts(null, v_stu) where subject_id = v_sub;
  select held into v_held from public.course_attendance(null, v_stu) where subject_id = v_sub;
  reset role;
  if v_parts <> 2 or v_held <> 2 then raise exception 'FAIL parts % (want 2), compiled held % (want 2)', v_parts, v_held; end if;

  -- the student asks for the practical absence to be corrected; the B1 teacher accepts
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  v_corr := public.request_attendance_correction(v_stu, v_today, 41::smallint, v_sub, 'QA I was at the lab bench all period');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p1u, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.decide_attendance_correction(v_corr, true, null);
  reset role;
  if (select status::text from public.attendance_record where student_id = v_stu and on_date = v_today and period = 41) <> 'present' then raise exception 'FAIL the correction did not apply'; end if;

  -- a practical-only subject: no phantom theory part
  update public.subject set components = '{practical}' where id = v_sub;
  delete from public.attendance_record where subject_id = v_sub and period = 40;
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  if exists (select 1 from public.course_attendance_parts(null, v_stu) where subject_id = v_sub and component = 'theory') then raise exception 'FAIL a phantom theory part'; end if;
  reset role;

  -- medical leave with a certificate, approved: the absence becomes "leave"; on duty: present
  perform set_config('request.jwt.claims', json_build_object('sub', p1u, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.mark_lecture(v_sec, v_sub, v_today, 41::smallint, array[v_stu], 'practical', 'B1', 'QA absent again');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  begin perform public.apply_student_leave(v_stu, v_today, v_today, 'QA fever', 'medical', null); raise exception 'FAIL medical without a certificate'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  reset role;
  v_key := public.tenant_prefix(11) || '/students/' || v_stu || '/leave/' || gen_random_uuid() || '.pdf';
  perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true); set local role authenticated;
  v_leave := public.apply_student_leave(v_stu, v_today, v_today, 'QA fever', 'medical', v_key);
  reset role;
  update public.leave_application set status = 'approved', decided_by = v_of, decided_at = now() where id = v_leave;
  if (select status::text from public.attendance_record where student_id = v_stu and on_date = v_today and period = 41) <> 'leave' then raise exception 'FAIL approved medical leave did not apply'; end if;
  raise notice 'attendance parts ok';
end $$;
rollback;
