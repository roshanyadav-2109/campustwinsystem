-- Self-test for 0115 on Greenfield (8). Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); v_staff bigint; v_g bigint; v_kid bigint; v_other bigint; gp bigint; hv bigint; ok boolean; n int;
begin
  select gs.guardian_id, gs.student_id into v_g, v_kid from public.guardian_student gs where gs.school_id = 8 limit 1;
  select e.student_id into v_other from public.student_enrollment e where e.school_id = 8 and e.student_id not in (select student_id from public.guardian_student where guardian_id = v_g) limit 1;
  insert into auth.users (id, email, aud, role) values (of, 'qa-fd-office@example.com', 'authenticated', 'authenticated'), (pa, 'qa-fd-parent@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA FD', 'qa-fd-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA FD', 8, v_staff);
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA FD Parent', 8, v_g);

  -- a parent asks for an early pick-up for their own child only
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.gate_pass (student_id, reason, pickup_name, pickup_relation, leave_at) values (v_kid, 'Doctor visit', 'QA Mother', 'Mother', now() + interval '2 hours') returning id into gp;
  ok := false; begin insert into public.gate_pass (student_id, reason, pickup_name, leave_at) values (v_other, 'x', 'x', now()); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent asked for another child'; end if;
  ok := false; begin update public.gate_pass set status = 'approved' where id = gp; exception when others then ok := true; end;
  if not ok and (select status from public.gate_pass where id = gp) = 'approved' then raise exception 'FAIL parent approved their own pass'; end if;
  ok := false; begin insert into public.visitor (name) values ('x'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent wrote the visitor log'; end if;
  reset role;

  -- the office approves and records the exit; the parent is told each time
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.gate_pass set status = 'approved', decided_by = v_staff where id = gp;
  update public.gate_pass set status = 'left', left_at = now() where id = gp;
  insert into public.visitor (name, phone, purpose, meeting) values ('QA Visitor', '9800000000', 'Meeting', 'Principal');
  update public.visitor set out_at = now() where name = 'QA Visitor';
  insert into public.health_visit (student_id, complaint, action_taken, sent_home) values (v_kid, 'Headache', 'Rested, given water', true) returning id into hv;
  reset role;
  select count(*) into n from public.notification where student_id = v_kid and event_key = 'gate_pass';
  if n < 2 * (select count(*) from public.guardian_student where student_id = v_kid) then raise exception 'FAIL parents not told about the gate pass (% messages)', n; end if;
  if not exists (select 1 from public.notification where student_id = v_kid and event_key = 'health_visit' and body like '%collect%') then raise exception 'FAIL parent not told about the health visit'; end if;

  -- the parent sees their child's health visit; not another child's
  insert into public.health_visit (school_id, student_id, complaint) values (8, v_other, 'QA other');
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not exists (select 1 from public.health_visit where id = hv) then raise exception 'FAIL parent cannot see own child visit'; end if;
  if exists (select 1 from public.health_visit where student_id = v_other) then raise exception 'FAIL parent sees another child health visit'; end if;
  if exists (select 1 from public.visitor) then raise exception 'FAIL parent reads visitors'; end if;
  reset role;
end $$;
rollback;
