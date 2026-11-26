-- Self-test for 0110 on Greenfield (8). Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); te uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); v_staff bigint; v_teacher bigint; v_g bigint;
  v_kid bigint; v_tok text; v_other_tok text; r record; ok boolean; c int; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-sa-office@example.com', 'authenticated', 'authenticated'),
    (te, 'qa-sa-teacher@example.com', 'authenticated', 'authenticated'), (pa, 'qa-sa-parent@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA SA Office', 'qa-sa-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA SA Office', 8, v_staff);
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA SA Teacher', 'qa-sa-teacher@example.com', 'subject_teacher') returning id into v_teacher;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (te, 'staff', 'QA SA Teacher', 8, v_teacher);
  -- a student with an active card and no attendance today
  select k.verify_token, k.student_id into v_tok, v_kid from public.id_card k where k.school_id = 8 and k.status = 'active'
    and not exists (select 1 from public.attendance_record a where a.student_id = k.student_id and a.on_date = v_today and a.period is null) limit 1;
  if v_tok is null then
    select e.student_id into v_kid from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current
      where e.school_id = 8 and e.status = 'active' and not exists (select 1 from public.attendance_record a where a.student_id = e.student_id and a.on_date = v_today and a.period is null)
        and not exists (select 1 from public.id_card k where k.student_id = e.student_id and k.status = 'active') limit 1;
    insert into public.id_card (school_id, student_id, academic_year_id) select 8, v_kid, y.id from public.academic_year y where y.school_id = 8 and y.is_current returning verify_token into v_tok;
  end if;
  select k.verify_token into v_other_tok from public.id_card k where k.school_id <> 8 and k.status = 'active' limit 1;
  select guardian_id into v_g from public.guardian_student where student_id = v_kid limit 1;
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA SA Parent', 8, v_g);

  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- the register lists staff; marking and the month totals
  select count(*) into c from public.staff_attendance_register(v_today);
  if c < 2 then raise exception 'FAIL register lists % staff', c; end if;
  insert into public.staff_attendance (staff_id, on_date, status, in_time) values (v_teacher, v_today, 'late', '09:20');
  ok := false; begin insert into public.staff_attendance (staff_id, on_date, status) values (v_teacher, v_today + 1, 'present'); exception when others then ok := sqlerrm like '%future%'; end;
  if not ok then raise exception 'FAIL future attendance'; end if;
  if (select late from public.staff_attendance_month(v_today) where staff_id = v_teacher) <> 1 then raise exception 'FAIL month totals'; end if;
  -- gate scan: present, then a second scan changes nothing
  select * into r from public.scan_student_card('https://verify.campustwin.org/verify/' || v_tok);
  if not r.ok or r.status <> 'present' then raise exception 'FAIL scan: %', r; end if;
  select * into r from public.scan_student_card(v_tok);
  if not r.ok or r.message not like 'Already marked%' then raise exception 'FAIL second scan: %', r; end if;
  if (select count(*) from public.attendance_record where student_id = v_kid and on_date = v_today and period is null) <> 1 then raise exception 'FAIL duplicate attendance'; end if;
  -- marked absent by the teacher, then scanned: late
  reset role;
  update public.attendance_record set status = 'absent' where student_id = v_kid and on_date = v_today and period is null;
  set local role authenticated;
  select * into r from public.scan_student_card(v_tok);
  if r.status <> 'late' then raise exception 'FAIL absent then scanned: %', r; end if;
  -- another institution's card and junk are refused
  if v_other_tok is not null then
    select * into r from public.scan_student_card(v_other_tok);
    if r.ok or r.message not like '%another institution%' then raise exception 'FAIL other school card: %', r; end if;
  end if;
  select * into r from public.scan_student_card('hello');
  if r.ok then raise exception 'FAIL junk accepted'; end if;
  reset role;
  -- a revoked card is refused
  update public.id_card set status = 'revoked', revoke_reason = 'QA' where verify_token = v_tok;
  set local role authenticated;
  select * into r from public.scan_student_card(v_tok);
  if r.ok or r.message not like '%cancelled%' then raise exception 'FAIL revoked card: %', r; end if;
  reset role;

  -- a teacher sees only their own attendance and cannot mark or scan
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.staff_attendance) <> 1 then raise exception 'FAIL teacher sees others'; end if;
  ok := false; begin insert into public.staff_attendance (staff_id, on_date, status) values (v_staff, v_today, 'present'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL teacher marked staff attendance'; end if;
  ok := false; begin perform public.scan_student_card(v_tok); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL teacher scanned a card'; end if;
  if (select count(*) from public.staff_attendance_register(v_today)) <> 0 then raise exception 'FAIL teacher reads the register'; end if;
  reset role;
  -- a parent cannot scan
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.scan_student_card(v_tok); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent scanned'; end if;
  reset role;
end $$;
rollback;
