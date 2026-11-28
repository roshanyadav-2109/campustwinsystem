-- Self-test for 0186 on Meridian (11): staff leave through the Head of Department before the office; finance head as office. Rolled back.
begin;
do $$ declare tu uuid := gen_random_uuid(); hu uuid := gen_random_uuid(); fu uuid := gen_random_uuid(); v_t bigint; v_h bigint; v_f bigint; v_dep bigint; v_lid bigint; ok boolean; v_type bigint;
begin
  insert into auth.users (id, email, aud, role) values (tu, 'qa-re-t@example.com', 'authenticated', 'authenticated'), (hu, 'qa-re-h@example.com', 'authenticated', 'authenticated'), (fu, 'qa-re-f@example.com', 'authenticated', 'authenticated');
  select id into v_dep from public.department where school_id = 11 limit 1;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Teacher', 'qa-re-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA HoD', 'qa-re-h@example.com', 'subject_teacher') returning id into v_h;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Finance', 'qa-re-f@example.com', 'subject_teacher') returning id into v_f;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (tu, 'staff', 'QA Teacher', 11, v_t), (hu, 'staff', 'QA HoD', 11, v_h), (fu, 'staff', 'QA Finance', 11, v_f);
  -- other heads of this department step aside for the test
  update public.staff_position p set ends_on = current_date - 1 from public.position_title t where t.id = p.title_id and p.school_id = 11 and t.access_type in ('dept_head', 'dean') and p.ends_on is null;
  insert into public.staff_position (school_id, staff_id, title_id, department_id) select 11, v_t, id, v_dep from public.position_title where school_id = 11 and access_type = 'faculty' limit 1;
  insert into public.staff_position (school_id, staff_id, title_id, department_id) select 11, v_h, id, v_dep from public.position_title where school_id = 11 and access_type = 'dept_head' limit 1;
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_f, id from public.position_title where school_id = 11 and access_type = 'finance_head' limit 1;
  if not found then
    insert into public.position_title (school_id, name, access_type, scope_level) values (11, 'QA Finance Officer', 'finance_head', 'campus') returning id into v_type;
    insert into public.staff_position (school_id, staff_id, title_id) values (11, v_f, v_type);
  end if;
  select id into v_type from public.staff_leave_type where school_id = 11 limit 1;
  -- the teacher asks for leave: it goes to the HoD first
  perform set_config('request.jwt.claims', json_build_object('sub', tu, 'role', 'authenticated')::text, true); set local role authenticated;
  insert into public.staff_leave (staff_id, academic_year_id, leave_type_id, from_date, to_date, days, reason, status)
  values (v_t, (select id from public.academic_year where school_id = 11 and is_current), v_type, current_date + 5, current_date + 5, 1, 'QA', 'pending') returning id into v_lid;
  reset role;
  if (select step from public.staff_leave where id = v_lid) <> 'hod' then raise exception 'FAIL first step %', (select steps from public.staff_leave where id = v_lid); end if;
  -- the office cannot approve before the HoD
  ok := false; begin update public.staff_leave set status = 'approved' where id = v_lid; exception when others then ok := sqlerrm like '%Head of Department%'; end;
  if not ok then raise exception 'FAIL approved before the HoD'; end if;
  -- the HoD sees it and passes it on
  perform set_config('request.jwt.claims', json_build_object('sub', hu, 'role', 'authenticated')::text, true); set local role authenticated;
  if not exists (select 1 from public.my_leave_steps() x where x.id = v_lid) then raise exception 'FAIL the HoD does not see it'; end if;
  if public.advance_staff_leave(v_lid, true, 'ok') <> 'final' then raise exception 'FAIL step'; end if;
  reset role;
  update public.staff_leave set status = 'approved' where id = v_lid;
  -- the finance head works as the office
  perform set_config('request.jwt.claims', json_build_object('sub', fu, 'role', 'authenticated')::text, true); set local role authenticated;
  if not app.is_office() then raise exception 'FAIL finance head is not office'; end if;
  reset role;
end $$;
rollback;
