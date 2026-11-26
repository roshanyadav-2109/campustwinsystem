-- Self-test for 0111 on Greenfield (8). Lessons are made for the test and rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); te uuid := gen_random_uuid(); v_off bigint; a bigint; b bigint; c bigint; v_year bigint; v_sec bigint; v_sec2 bigint; v_subj bigint;
  s1 bigint; s2 bigint; d date := (now() at time zone 'Asia/Kolkata')::date; n int; ok boolean; v_sub bigint;
begin
  if extract(isodow from d) = 7 then d := d - 1; end if;   -- no lessons on Sunday
  select id into v_year from public.academic_year where school_id = 8 and is_current;
  select id into v_sec from public.section where school_id = 8 order by id limit 1;
  select id into v_sec2 from public.section where school_id = 8 and id <> v_sec order by id limit 1;
  select id into v_subj from public.subject where school_id = 8 order by id limit 1;
  insert into public.timetable_period (school_id, period_no, label, start_time, end_time, is_break)
    select 8, x, 'Period ' || x, ('08:00'::time + (x - 1) * interval '45 minutes'), ('08:40'::time + (x - 1) * interval '45 minutes'), false
    from generate_series(1, 2) x where not exists (select 1 from public.timetable_period p where p.school_id = 8 and p.period_no = x);
  insert into public.staff (school_id, full_name, role) values (8, 'QA Teacher A', 'subject_teacher') returning id into a;
  insert into public.staff (school_id, full_name, role) values (8, 'QA Teacher B', 'subject_teacher') returning id into b;
  insert into public.staff (school_id, full_name, role) values (8, 'QA Teacher C', 'subject_teacher') returning id into c;
  insert into public.teacher_allotment (staff_id, section_id, subject_id, academic_year_id, is_class_teacher, school_id) values (b, v_sec, v_subj, v_year, false, 8);
  insert into public.timetable_slot (academic_year_id, section_id, day_of_week, period_no, subject_id, staff_id, school_id)
    values (v_year, v_sec, extract(isodow from d), 1, v_subj, a, 8) returning id into s1;
  insert into public.timetable_slot (academic_year_id, section_id, day_of_week, period_no, subject_id, staff_id, school_id)
    values (v_year, v_sec2, extract(isodow from d), 2, v_subj, a, 8) returning id into s2;
  -- C is busy in period 1
  insert into public.timetable_slot (academic_year_id, section_id, day_of_week, period_no, subject_id, staff_id, school_id)
    values (v_year, v_sec2, extract(isodow from d), 1, v_subj, c, 8);
  insert into auth.users (id, email, aud, role) values (of, 'qa-sub-office@example.com', 'authenticated', 'authenticated'), (te, 'qa-sub-teacher@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA Sub Office', 'qa-sub-office@example.com', 'office') returning id into v_off;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Sub Office', 8, v_off);
  insert into public.profile (id, role, full_name, school_id, staff_id) values (te, 'staff', 'QA Teacher C', 8, c);
  insert into public.staff_attendance (school_id, staff_id, on_date, status) values (8, a, d, 'absent');

  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.substitution_needs(d) where absent_staff_id = a;
  if n <> 2 then raise exception 'FAIL % lessons of the absent teacher', n; end if;
  -- B teaches the subject and section: first; C is busy in period 1: not offered
  if not exists (select 1 from public.substitution_candidates(d, s1) where staff_id = b and teaches_subject and teaches_section) then raise exception 'FAIL B not offered as a subject and section teacher'; end if;
  if not (select teaches_subject from public.substitution_candidates(d, s1) limit 1) then raise exception 'FAIL top suggestion does not teach the subject'; end if;
  if exists (select 1 from public.substitution_candidates(d, s1) where staff_id = c) then raise exception 'FAIL busy teacher offered'; end if;
  if exists (select 1 from public.substitution_candidates(d, s1) where staff_id = a) then raise exception 'FAIL absent teacher offered'; end if;
  insert into public.substitution (on_date, slot_id, substitute_staff_id) values (d, s1, b) returning id into v_sub;
  ok := false; begin insert into public.substitution (on_date, slot_id, substitute_staff_id) values (d, s2, c); exception when others then ok := true; end;
  if ok then null; end if;   -- C is free in period 2, so this one is fine
  delete from public.substitution where slot_id = s2;
  -- the same teacher cannot take two classes in one period; a busy teacher is refused
  ok := false; begin insert into public.substitution (on_date, slot_id, substitute_staff_id) values (d, s1, c); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL second substitute for one lesson or busy teacher accepted'; end if;
  reset role;
  if not exists (select 1 from public.notification where staff_id = b and event_key = 'substitution') then raise exception 'FAIL substitute not told'; end if;
  -- a teacher cannot assign substitutions
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.substitution (on_date, slot_id, substitute_staff_id) values (d, s2, c); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL teacher assigned a substitution'; end if;
  if (select count(*) from public.substitution_needs(d)) <> 0 then raise exception 'FAIL teacher reads substitution needs'; end if;
  reset role;
end $$;
rollback;
