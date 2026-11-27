-- Self-test for 0121 on Meridian (11). Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_staff bigint; v_sem bigint; k1 bigint; k2 bigint; v_prog bigint; v_semno int; e1 bigint; e2 bigint; c1 bigint; c2 bigint; n int; ok boolean;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-cr-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA CR', 'qa-cr-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA CR', 11, v_staff);
  select id into v_sem from public.semester where school_id = 11 and is_current;
  -- two students of the same class
  select e.student_id into k1 from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
   where e.school_id = 11 and e.status = 'active' and c.programme_id is not null order by e.student_id limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select p.programme_id, p.semester_no into v_prog, v_semno from public.student_semester(k1, v_sem) p;
  select e.student_id into k2 from public.student_enrollment e join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
   where e.school_id = 11 and e.status = 'active' and c.programme_id = v_prog and e.student_id <> k1
     and (select semester_no from public.student_semester(e.student_id, v_sem)) = v_semno order by e.student_id limit 1;
  -- core courses for everyone
  n := public.register_core_courses(v_sem);
  if not exists (select 1 from public.course_registration where student_id = k1 and semester_id = v_sem) then raise exception 'FAIL core registration %', n; end if;
  if public.register_core_courses(v_sem) <> 0 then raise exception 'FAIL core registered twice'; end if;
  -- an elective group of two courses, one seat each
  insert into public.course (code, name, kind, credits) values ('QAE1', 'QA Elective One', 'elective', 3) returning id into c1;
  insert into public.course (code, name, kind, credits) values ('QAE2', 'QA Elective Two', 'elective', 3) returning id into c2;
  insert into public.programme_course (programme_id, course_id, semester_no, elective_group, seat_limit) values (v_prog, c1, v_semno, 'QA open', 1) returning id into e1;
  insert into public.programme_course (programme_id, course_id, semester_no, elective_group, seat_limit) values (v_prog, c2, v_semno, 'QA open', 1) returning id into e2;
  perform public.register_course(v_sem, k1, e1);
  ok := false; begin perform public.register_course(v_sem, k2, e1); exception when others then ok := sqlerrm like '%full%'; end;
  if not ok then raise exception 'FAIL elective over its seats'; end if;
  perform public.register_course(v_sem, k2, e2);
  -- changing choice frees the old seat (one per group)
  ok := false; begin perform public.register_course(v_sem, k1, e2); exception when others then ok := sqlerrm like '%full%'; end;
  if not ok then raise exception 'FAIL second elective seat taken twice'; end if;
  perform public.drop_course(v_sem, k2, e2);
  perform public.register_course(v_sem, k1, e2);
  if (select count(*) from public.course_registration r join public.programme_course x on x.id = r.programme_course_id where r.student_id = k1 and x.elective_group = 'QA open' and r.status <> 'dropped') <> 1 then
    raise exception 'FAIL more than one choice in a group'; end if;
  -- credit limit
  update public.programme set max_credits_per_semester = 1 where id = v_prog;
  ok := false; begin perform public.register_course(v_sem, k2, e1); exception when others then ok := sqlerrm like '%over%credits%'; end;
  if not ok then raise exception 'FAIL credit limit'; end if;
  reset role;
end $$;
rollback;
