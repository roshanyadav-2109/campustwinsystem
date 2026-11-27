-- Self-test for 0145 on Meridian (11): Head of Department and Dean scope.
-- Rolled back.
begin;
do $$ declare te uuid := gen_random_uuid(); of uuid := gen_random_uuid(); v_t bigint; v_off bigint; v_da bigint; v_db bigint; v_seca bigint; v_secb bigint; ka bigint; kb bigint;
  v_sem bigint; v_reg bigint; v_ra bigint; v_rb bigint; ok boolean; n int; pr uuid := gen_random_uuid(); v_pr bigint; v_prog bigint; v_rq bigint;
begin
  -- two departments, each with a section that has students
  select g.department_id, sec.id into v_da, v_seca from public.section sec join public.class c on c.id = sec.class_id join public.programme g on g.id = c.programme_id
   where g.school_id = 11 and exists (select 1 from public.student_enrollment e where e.section_id = sec.id and e.status = 'active') order by g.department_id, sec.id limit 1;
  select g.department_id, sec.id into v_db, v_secb from public.section sec join public.class c on c.id = sec.class_id join public.programme g on g.id = c.programme_id
   where g.school_id = 11 and g.department_id <> v_da and exists (select 1 from public.student_enrollment e where e.section_id = sec.id and e.status = 'active') order by sec.id limit 1;
  if v_db is null then raise exception 'FAIL need two departments with students'; end if;
  select student_id into ka from public.student_enrollment where section_id = v_seca and status = 'active' limit 1;
  select student_id into kb from public.student_enrollment where section_id = v_secb and status = 'active' limit 1;
  select id into v_sem from public.semester where school_id = 11 and is_current;

  insert into auth.users (id, email, aud, role) values (te, 'qa-hod@example.com', 'authenticated', 'authenticated'), (of, 'qa-hod-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA HoD', 'qa-hod@example.com', 'subject_teacher') returning id into v_t;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-hod-office@example.com', 'office') returning id into v_off;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (te, 'staff', 'QA HoD', 11, v_t), (of, 'staff', 'QA Office', 11, v_off);
  insert into public.staff_position (school_id, staff_id, title_id, department_id)
  select 11, v_t, id, v_da from public.position_title where school_id = 11 and access_type = 'dept_head' limit 1;

  -- registrations waiting for approval, one in each department
  insert into public.course_registration (school_id, semester_id, student_id, programme_course_id, status)
  select 11, v_sem, ka, pc.id, 'registered' from public.student_semester(ka, v_sem) ss join public.programme_course pc on pc.programme_id = ss.programme_id and pc.semester_no = ss.semester_no
   where not exists (select 1 from public.course_registration r where r.semester_id = v_sem and r.student_id = ka and r.programme_course_id = pc.id) limit 1 returning id into v_ra;
  if v_ra is null then update public.course_registration set status = 'registered' where id = (select id from public.course_registration where semester_id = v_sem and student_id = ka limit 1) returning id into v_ra; end if;
  update public.course_registration set status = 'registered' where id = (select id from public.course_registration where semester_id = v_sem and student_id = kb limit 1) returning id into v_rb;

  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if not (v_seca in (select app.my_scope_sections())) or v_secb in (select app.my_scope_sections()) then raise exception 'FAIL HoD sections'; end if;
  if (select count(*) from public.student where id = ka) <> 1 then raise exception 'FAIL HoD cannot read own student'; end if;
  if (select count(*) from public.student where id = kb) <> 0 then raise exception 'FAIL HoD reads another department'; end if;
  if app.is_admin_scope() or app.is_office() then raise exception 'FAIL HoD got campus-wide rights'; end if;
  n := public.approve_registrations(v_sem, array[v_ra, coalesce(v_rb, 0)]);
  if n <> 1 then raise exception 'FAIL HoD approved % registrations (expected 1)', n; end if;
  perform count(*) from public.compute_course_results(v_sem, v_seca);
  ok := false; begin perform count(*) from public.compute_course_results(v_sem, v_secb); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL HoD previewed another department'; end if;
  reset role;

  -- approval step "hod": only for their own students
  insert into public.relaxation_request (school_id, kind, semester_id, student_id, subject_id, reason, chain, requested_by)
  select 11, 'attendance', v_sem, ka, (select id from public.subject where school_id = 11 limit 1), 'QA hod step', array['hod'], of returning id into v_reg;
  insert into public.relaxation_request (school_id, kind, semester_id, student_id, subject_id, reason, chain, requested_by)
  select 11, 'attendance', v_sem, kb, (select id from public.subject where school_id = 11 limit 1), 'QA hod step B', array['hod'], of returning id into v_rb;
  if not exists (select 1 from public.relax_step_staff(v_reg) x where x = v_t) then raise exception 'FAIL HoD not told'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if not public.relax_can_act(v_reg) or public.relax_can_act(v_rb) then raise exception 'FAIL hod step scope'; end if;
  reset role;

  -- the whole-campus attendance summary is refused to an HoD
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform count(*) from public.course_attendance(null, null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL HoD read the whole campus attendance'; end if;
  -- the HoD cannot act on a request they raised
  reset role;
  insert into public.relaxation_request (school_id, kind, semester_id, student_id, subject_id, reason, chain, requested_by)
  select 11, 'attendance', v_sem, ka, (select id from public.subject where school_id = 11 and id <> (select subject_id from public.relaxation_request where id = v_reg) order by id limit 1), 'QA own request', array['hod'], te returning id into v_rq;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.relax_can_act(v_rq) then raise exception 'FAIL HoD acted on own request'; end if;
  reset role;
  -- with no other HoD the step goes to the head (a principal)
  insert into auth.users (id, email, aud, role) values (pr, 'qa-hod-head@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Head', 'qa-hod-head@example.com', 'principal') returning id into v_pr;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (pr, 'staff', 'QA Head', 11, v_pr);
  delete from public.staff_position p using public.position_title t where t.id = p.title_id and p.school_id = 11 and t.access_type = 'dept_head' and p.department_id = v_da and p.staff_id <> v_t;
  perform set_config('request.jwt.claims', json_build_object('sub', pr, 'role', 'authenticated')::text, true); set local role authenticated;
  if not public.relax_can_act(v_rq) then raise exception 'FAIL vacant HoD step not with the head'; end if;
  if public.relax_can_act(v_reg) then raise exception 'FAIL head took a filled HoD step'; end if;
  reset role;
  if not exists (select 1 from public.relax_step_staff(v_rq) x where x = v_pr) then raise exception 'FAIL head not told of vacant step'; end if;
  -- a Programme Coordinator sees only their programme
  delete from public.staff_position where staff_id = v_t;
  select c.programme_id into v_prog from public.section sec join public.class c on c.id = sec.class_id where sec.id = v_seca;
  insert into public.staff_position (school_id, staff_id, title_id, programme_id) select 11, v_t, id, v_prog from public.position_title where school_id = 11 and access_type = 'programme_coord' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if not (v_seca in (select app.my_scope_sections())) or exists (select 1 from public.section sec join public.class c on c.id = sec.class_id where sec.id in (select app.my_scope_sections()) and c.programme_id <> v_prog) then
    raise exception 'FAIL coordinator scope';
  end if;
  reset role;
  -- a Dean of the faculty covers every department in it
  delete from public.staff_position where staff_id = v_t;
  insert into public.staff_position (school_id, staff_id, title_id, unit_id)
  select 11, v_t, t.id, d.unit_id from public.position_title t, public.department d where t.school_id = 11 and t.access_type = 'dean' and t.scope_level = 'faculty' and d.id = v_da limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if (select unit_id from public.department where id = v_db) = (select unit_id from public.department where id = v_da) and not (v_secb in (select app.my_scope_sections())) then
    raise exception 'FAIL Dean does not cover the faculty';
  end if;
  if app.is_admin_scope() then raise exception 'FAIL Dean got campus-wide rights'; end if;
  reset role;
end $$;
rollback;
