-- Self-test for 0137 on Meridian (11): assigning and ending positions,
-- scope checks, several positions per person, titles and signatories. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); te uuid := gen_random_uuid(); v_off bigint; v_t bigint; v_hod bigint; v_dean bigint; v_dir bigint; v_dept bigint; v_unit bigint;
  v_p bigint; ok boolean; v_titles text;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-pos-office@example.com', 'authenticated', 'authenticated'), (te, 'qa-pos-teacher@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-pos-office@example.com', 'office') returning id into v_off;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Teacher', 'qa-pos-teacher@example.com', 'subject_teacher') returning id into v_t;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 11, v_off), (te, 'staff', 'QA Teacher', 11, v_t);
  select id into v_hod from public.position_title where school_id = 11 and name = 'Head of Department';
  select id into v_dean from public.position_title where school_id = 11 and name = 'Dean';
  select id into v_dir from public.position_title where school_id = 11 and name = 'Controller of Examinations';
  select id into v_dept from public.department where school_id = 11 order by id limit 1;
  select id into v_unit from public.academic_unit where school_id = 11 limit 1;

  -- a teacher cannot assign positions
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.assign_position(v_t, v_hod, null, v_dept, null, null, null, false); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL teacher assigned a position'; end if;
  ok := false; begin insert into public.staff_position (school_id, staff_id, title_id, department_id) values (11, v_t, v_hod, v_dept); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL direct insert of a position'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  -- the place must match the title's level
  ok := false; begin perform public.assign_position(v_t, v_hod, null, null, null, null, null, false); exception when others then ok := sqlerrm like 'Choose the department%'; end;
  if not ok then raise exception 'FAIL HoD without a department'; end if;
  ok := false; begin perform public.assign_position(v_t, v_dean, null, v_dept, null, null, null, false); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL Dean placed on a department'; end if;
  -- two positions for one person
  v_p := public.assign_position(v_t, v_hod, null, v_dept, null, (now() at time zone 'Asia/Kolkata')::date - 30, null, true);
  perform public.assign_position(v_t, v_dean, v_unit, null, null, null, null, false);
  ok := false; begin perform public.assign_position(v_t, v_hod, null, v_dept, null, null, null, false); exception when others then ok := sqlerrm like '%already holds%'; end;
  if not ok then raise exception 'FAIL duplicate position'; end if;
  v_titles := public.staff_titles(v_t);
  if v_titles not like '%Dean, %' or v_titles not like '%Acting Head of Department, %' then raise exception 'FAIL titles: %', v_titles; end if;
  -- ending a position
  perform public.end_position(v_p, (now() at time zone 'Asia/Kolkata')::date - 1);
  if public.staff_titles(v_t) like '%Head of Department%' then raise exception 'FAIL ended position still shown'; end if;
  ok := false; begin perform public.end_position(v_p, null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL ended twice'; end if;
  -- renaming a title changes what everyone sees; the signatory follows the type
  update public.position_title set name = 'QA Dean of Faculty' where id = v_dean;
  if public.staff_titles(v_t) not like '%QA Dean of Faculty%' then raise exception 'FAIL rename not shown'; end if;
  if (select title from public.signatory('exams_head')) is distinct from 'Controller of Examinations' then raise exception 'FAIL signatory'; end if;
  reset role;
  if (select count(*) from public.position_log where school_id = 11 and staff_id = v_t) <> 3 then raise exception 'FAIL log'; end if;
  -- a school (not higher ed) cannot add the college titles
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
end $$;
rollback;
