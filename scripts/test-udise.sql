-- Self-test for 0109: the office of Greenfield exports every active student
-- (more than 1000 would page), missing details are listed, parents cannot. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); v_staff bigint; v_g bigint; n int; m int; ok boolean;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-ud-office@example.com', 'authenticated', 'authenticated'), (pa, 'qa-ud-parent@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (8, 'QA UD', 'qa-ud-office@example.com', 'office') returning id into v_staff;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA UD', 8, v_staff);
  select guardian_id into v_g from public.guardian_student where school_id = 8 limit 1;
  insert into public.profile (id, role, full_name, school_id, guardian_id) values (pa, 'guardian', 'QA UD P', 8, v_g);
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.udise_student_rows();
  reset role;
  select count(*) into m from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current where e.school_id = 8 and e.status = 'active';
  if n <> m or n = 0 then raise exception 'FAIL exported % of % students', n, m; end if;
  set local role authenticated;
  if not exists (select 1 from public.udise_student_rows() where cardinality(missing) > 0) and not exists (select 1 from public.udise_student_rows()) then raise exception 'FAIL nothing'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.udise_student_rows(); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL parent exported UDISE data'; end if;
  reset role;
end $$;
rollback;
