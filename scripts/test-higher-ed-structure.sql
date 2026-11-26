-- Self-test for 0119: a college office sets up structure; a school cannot; credits add up. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); sof uuid := gen_random_uuid(); v_staff bigint; v_s2 bigint; d bigint; p bigint; c1 bigint; c2 bigint; ok boolean; r record;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-he-office@example.com', 'authenticated', 'authenticated'), (sof, 'qa-he-school@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA HE', 'qa-he-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA HE', 11, v_staff);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA HE School', 'qa-he-school@example.com', 'office') returning id into v_s2;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (sof, 'staff', 'QA HE School', 8, v_s2);
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.department (code, name) values ('QAD', 'QA Department') returning id into d;
  insert into public.programme (department_id, code, name, years, semesters) values (d, 'QAP', 'QA Programme', 3, 6) returning id into p;
  insert into public.course (department_id, code, name, credits) values (d, 'QA101', 'QA Course One', 4) returning id into c1;
  insert into public.course (department_id, code, name, kind, credits) values (d, 'QA102', 'QA Elective', 'elective', 3) returning id into c2;
  insert into public.programme_course (programme_id, course_id, semester_no) values (p, c1, 1);
  insert into public.programme_course (programme_id, course_id, semester_no, elective_group) values (p, c2, 1, 'Open elective');
  select * into r from public.programme_credits(p) where semester_no = 1;
  if r.credits <> 7 then raise exception 'FAIL credits %', r.credits; end if;
  ok := false; begin insert into public.programme_course (programme_id, course_id, semester_no) values (p, c1, 9); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL semester beyond the programme'; end if;
  reset role;
  -- a school cannot have programmes
  perform set_config('request.jwt.claims', json_build_object('sub', sof, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin insert into public.department (code, name) values ('X', 'X'); exception when others then ok := sqlerrm like '%colleges and universities%'; end;
  if not ok then raise exception 'FAIL a school created a department'; end if;
  if exists (select 1 from public.programme where id = p) then raise exception 'FAIL school sees another institution programme'; end if;
  reset role;
end $$;
rollback;
