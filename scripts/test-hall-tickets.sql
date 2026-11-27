-- Self-test for 0129 on Meridian (11). Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_staff bigint; v_sem record; v_sec bigint; v_class bigint; k bigint; v_subj bigint; v_type bigint; v_sess bigint; r record; d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-ht-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA HT', 'qa-ht-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA HT', 11, v_staff);
  select * into v_sem from public.semester where school_id = 11 and is_current;
  update public.semester set starts_on = least(starts_on, d - 10), ends_on = greatest(ends_on, d) where id = v_sem.id;
  select * into v_sem from public.semester where id = v_sem.id;
  select r2.student_id, e.section_id into k, v_sec from public.course_registration r2 join public.student_enrollment e on e.student_id = r2.student_id and e.status = 'active'
   where r2.semester_id = v_sem.id and r2.status <> 'dropped' limit 1;
  select class_id into v_class from public.section where id = v_sec;
  select sb.id into v_subj from public.course_registration r2 join public.programme_course pc on pc.id = r2.programme_course_id join public.subject sb on sb.course_id = pc.course_id
   join public.class_subject cs on cs.subject_id = sb.id and cs.class_id = v_class where r2.student_id = k and r2.semester_id = v_sem.id limit 1;
  select id into v_type from public.assessment_type where school_id = 11 and code = 'annual';
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.exam_session (academic_year_id, name, term, assessment_type_id) values (v_sem.academic_year_id, 'QA End-Semester', 1, v_type) returning id into v_sess;
  select * into r from public.prepare_admit_cards(v_sess, v_sec, k);
  if r.subject_ids is null or not (v_subj = any(r.subject_ids)) then raise exception 'FAIL hall ticket courses %', r.subject_ids; end if;
  if r.withheld then raise exception 'FAIL held without reason: %', r.reason; end if;
  -- three lectures, absent in all: below 75%, held back
  perform public.mark_lecture(v_sec, v_subj, d - 3, 8::smallint, array[k]);
  perform public.mark_lecture(v_sec, v_subj, d - 2, 8::smallint, array[k]);
  perform public.mark_lecture(v_sec, v_subj, d - 1, 8::smallint, array[k]);
  select * into r from public.prepare_admit_cards(v_sess, v_sec, k);
  if not r.withheld or r.reason not like 'Attendance below%' or r.verify_token is not null then raise exception 'FAIL shortage not held: %', r; end if;
  -- condoned: released
  reset role;
  insert into public.attendance_condonation (school_id, semester_id, student_id, subject_id, reason) values (11, v_sem.id, k, v_subj, 'QA medical');
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from public.prepare_admit_cards(v_sess, v_sec, k);
  if r.withheld then raise exception 'FAIL condoned still held: %', r.reason; end if;
  reset role;
end $$;
rollback;
