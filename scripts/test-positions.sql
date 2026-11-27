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
  -- access: the office cannot give a top position, nor one to itself
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.assign_position(v_t, v_dir, null, null, null, null, null, false); exception when others then ok := sqlerrm like 'Only the head%'; end;
  if not ok then raise exception 'FAIL office assigned a top position'; end if;
  ok := false; begin perform public.assign_position(v_off, v_hod, null, v_dept, null, null, null, false); exception when others then ok := sqlerrm like 'Someone else%'; end;
  if not ok then raise exception 'FAIL self-assignment'; end if;
  ok := false; begin update public.position_title set access_type = 'head' where id = v_hod; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL office turned a title into a head'; end if;
  -- Meridian has a CoE: the office does not publish
  if app.can_publish_results() then raise exception 'FAIL office can publish beside a CoE'; end if;
  reset role;
  -- a teacher made Registrar works as the office; made CoE, publishes and runs exams
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_t, id from public.position_title where school_id = 11 and access_type = 'registrar' and scope_level = 'campus' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if not app.is_office() or app.is_principal() then raise exception 'FAIL registrar access'; end if;
  reset role;
  delete from public.staff_position where staff_id = v_t and title_id in (select id from public.position_title where access_type = 'registrar');
  insert into public.staff_position (school_id, staff_id, title_id) values (11, v_t, v_dir);
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if app.is_office() or not app.is_exams() or not app.can_publish_results() then raise exception 'FAIL exams head access'; end if;
  reset role;
  -- an ended position gives nothing
  update public.staff_position set starts_on = current_date - 10, ends_on = current_date - 1 where staff_id = v_t and title_id = v_dir;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if app.is_exams() then raise exception 'FAIL ended position still gives access'; end if;
  reset role;
end $$;
rollback;
