-- Self-test for 0123 on Meridian (11): four lectures, one student absent twice -> 50%, short; condoned. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_staff bigint; v_sec bigint; v_subj bigint; k bigint; r record; d date := (now() at time zone 'Asia/Kolkata')::date; ok boolean; v_sem bigint;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-la-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA LA', 'qa-la-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA LA', 11, v_staff);
  select id into v_sem from public.semester where school_id = 11 and is_current;
  -- the semester covers today for the test
  update public.semester set starts_on = least(starts_on, d - 10), ends_on = greatest(ends_on, d) where id = v_sem;
  select e.section_id, e.student_id into v_sec, k from public.student_enrollment e where e.school_id = 11 and e.status = 'active' limit 1;
  select cs.subject_id into v_subj from public.class_subject cs join public.section s on s.class_id = cs.class_id where s.id = v_sec limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.mark_lecture(v_sec, v_subj, d - 3, 1::smallint, array[k]);
  perform public.mark_lecture(v_sec, v_subj, d - 2, 1::smallint, array[k]);
  perform public.mark_lecture(v_sec, v_subj, d - 1, 1::smallint, '{}');
  perform public.mark_lecture(v_sec, v_subj, d, 2::smallint, '{}');
  -- marking the same lecture again replaces it
  perform public.mark_lecture(v_sec, v_subj, d, 2::smallint, '{}');
  select * into r from public.course_attendance(v_sec) where student_id = k and subject_id = v_subj;
  if r.held <> 4 or r.attended <> 2 or not r.short then raise exception 'FAIL attendance: %', r; end if;
  insert into public.attendance_condonation (semester_id, student_id, subject_id, reason) values (v_sem, k, v_subj, 'Medical certificate');
  if not (select condoned from public.course_attendance(v_sec) where student_id = k and subject_id = v_subj) then raise exception 'FAIL condonation'; end if;
  ok := false; begin perform public.mark_lecture(v_sec, v_subj, d + 1, 1::smallint, '{}'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL future lecture'; end if;
  -- the daily register is untouched
  if exists (select 1 from public.attendance_record where section_id = v_sec and on_date between d - 3 and d and period is null and marked_by = v_staff) then raise exception 'FAIL daily rows written'; end if;
  reset role;
end $$;
rollback;
