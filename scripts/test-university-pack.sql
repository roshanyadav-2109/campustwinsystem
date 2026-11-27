-- Self-test for 0173 on Westbridge (university 2: campuses 14, 15, 16). Rolled back.
begin;
do $$ declare cu uuid := gen_random_uuid(); ot uuid := gen_random_uuid(); k bigint; v_adm text; v_sec bigint; j jsonb; n int; v_new bigint; ok boolean; v_cr int; v_ca bigint;
begin
  insert into auth.users (id, email, aud, role) values (cu, 'qa-up-c@example.com', 'authenticated', 'authenticated'), (ot, 'qa-up-o@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (14, 'QA Central', 'qa-up-c@example.com', 'office') returning id into v_ca;
  insert into public.profile (id, role, full_name, school_id, staff_id, university_id, active_campus_id) values (cu, 'staff', 'QA Central', 14, v_ca, 2, 14);
  -- a student with a parent, no fees due, no malpractice
  select st.id, st.admission_no into k, v_adm from public.student st
   where st.school_id = 14 and st.status = 'active' and exists (select 1 from public.guardian_student gs where gs.student_id = st.id)
     and not exists (select 1 from public.fee_invoice i where i.student_id = st.id and i.status in ('due', 'part')) limit 1;
  if k is null then raise exception 'SETUP no student'; end if;
  insert into public.profile (id, role, full_name, school_id, student_id) values (ot, 'student', 'QA Student', 14, k);
  select count(*) into v_cr from public.course_result where student_id = k;
  select id into v_sec from public.section where school_id = 15 limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true); set local role authenticated;
  select count(*) into n from public.university_exam_overview();
  if n <> 3 then raise exception 'FAIL overview campuses %', n; end if;
  j := public.copy_catalogue(14, 15);
  if j ->> 'courses' is null then raise exception 'FAIL catalogue %', j; end if;
  -- outside the university: refused
  ok := false; begin perform public.copy_catalogue(14, 11); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL copied to a campus of another institution'; end if;
  j := public.transfer_student(14, v_adm, 15, v_sec, 'QA move');
  v_new := (j ->> 'student_id')::bigint;
  reset role;
  if (select status from public.student where id = k) <> 'transferred' then raise exception 'FAIL old record not closed'; end if;
  if (select school_id from public.student where id = v_new) <> 15 then raise exception 'FAIL new record not at the new campus'; end if;
  if not exists (select 1 from public.student_enrollment where student_id = v_new and section_id = v_sec and status = 'active') then raise exception 'FAIL not enrolled'; end if;
  if not exists (select 1 from public.guardian_student where student_id = v_new and school_id = 15) then raise exception 'FAIL parent not carried'; end if;
  if (select school_id from public.profile where id = ot) <> 15 or (select student_id from public.profile where id = ot) <> v_new then raise exception 'FAIL login not moved'; end if;
  if not exists (select 1 from public.person_membership where user_id = ot and school_id = 14) then raise exception 'FAIL old record no longer readable'; end if;
  if (j ->> 'carried')::int + coalesce(cardinality(string_to_array(j ->> 'not_carried', ', ')), 0) = 0 and v_cr > 0 then raise exception 'FAIL grades neither carried nor listed %', j; end if;
  if not exists (select 1 from public.student_transfer where to_student = v_new and from_student = k) then raise exception 'FAIL not logged'; end if;
  -- a campus admin (not central) cannot transfer
  perform set_config('request.jwt.claims', json_build_object('sub', ot, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.transfer_student(15, v_adm, 14, (select id from public.section where school_id = 14 limit 1)); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL non-central transfer allowed'; end if;
  reset role;
  raise notice 'carried % of %: %', j ->> 'carried', v_cr, j;
end $$;
rollback;
