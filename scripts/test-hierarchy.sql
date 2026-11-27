-- Self-test for 0147: nested units, transfer, university-wide positions,
-- the chart and chain labels. Meridian (11) and Westbridge (14, 15). Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); te uuid := gen_random_uuid(); ca uuid := gen_random_uuid(); wo uuid := gen_random_uuid();
  v_off bigint; v_t bigint; v_new bigint; v_top bigint; v_fac bigint; v_hod bigint; v_newp bigint; ok boolean; v_ca bigint; v_wo bigint; v_coe bigint; j jsonb;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-h-office@example.com', 'authenticated', 'authenticated'), (te, 'qa-h-t@example.com', 'authenticated', 'authenticated'),
    (ca, 'qa-h-central@example.com', 'authenticated', 'authenticated'), (wo, 'qa-h-wb-office@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-h-office@example.com', 'office') returning id into v_off;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Lecturer', 'qa-h-t@example.com', 'subject_teacher') returning id into v_t;
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA New HoD', null, 'subject_teacher') returning id into v_new;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 11, v_off), (te, 'staff', 'QA Lecturer', 11, v_t);

  -- nesting: a group above the existing faculty; a Dean there covers everything below
  select id into v_fac from public.academic_unit where school_id = 11 limit 1;
  insert into public.academic_unit (school_id, code, name, kind) values (11, 'QAENG', 'QA School of Engineering', 'school') returning id into v_top;
  update public.academic_unit set parent_id = v_top where id = v_fac;
  ok := false; begin update public.academic_unit set parent_id = v_fac where id = v_top; exception when others then ok := sqlerrm like '%under itself%'; end;
  if not ok then raise exception 'FAIL a unit sat under itself'; end if;
  insert into public.staff_position (school_id, staff_id, title_id, unit_id) select 11, v_t, id, v_top from public.position_title where school_id = 11 and access_type = 'dean' and scope_level = 'faculty' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', te, 'role', 'authenticated')::text, true); set local role authenticated;
  if not exists (select 1 from app.my_dean_departments()) or (select count(*) from app.my_dean_departments()) <> (select count(*) from public.department where unit_id = v_fac) then
    raise exception 'FAIL Dean above does not cover the units below';
  end if;
  reset role;

  -- transfer: a Head of Department hands over in one step
  select p.id into v_hod from public.staff_position p join public.position_title t on t.id = p.title_id where p.school_id = 11 and t.access_type = 'dept_head' and p.ends_on is null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  v_newp := public.transfer_position(v_hod, v_new, (now() at time zone 'Asia/Kolkata')::date, false);
  reset role;
  if (select ends_on from public.staff_position where id = v_hod) <> (now() at time zone 'Asia/Kolkata')::date - 1 and (select ends_on from public.staff_position where id = v_hod) <> (select starts_on from public.staff_position where id = v_hod) then
    raise exception 'FAIL old holder not ended';
  end if;
  if (select staff_id from public.staff_position where id = v_newp) <> v_new then raise exception 'FAIL new holder'; end if;
  if not exists (select 1 from public.position_log where action = 'transferred' and staff_id = v_new) then raise exception 'FAIL transfer not logged'; end if;
  -- the office cannot hand over the head's position
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.transfer_position((select p.id from public.staff_position p join public.position_title t on t.id = p.title_id where p.school_id = 11 and t.access_type = 'head' limit 1), v_new, null, false);
    exception when others then ok := true; end;
  if not ok then raise exception 'FAIL office transferred the head'; end if;
  -- the chart and the labels
  j := public.org_chart();
  if jsonb_array_length(j -> 'positions') = 0 or jsonb_array_length(j -> 'units') < 2 then raise exception 'FAIL chart'; end if;
  if public.chain_labels() ->> 'hod' is null or public.chain_labels() ->> 'head' is null then raise exception 'FAIL labels %', public.chain_labels(); end if;
  reset role;

  -- university-wide: a central CoE (home campus 14) counts at campus 15
  insert into public.staff (school_id, full_name, email, role) values (14, 'QA Central CoE', 'qa-h-central@example.com', 'subject_teacher') returning id into v_ca;
  insert into public.profile (id, role, full_name, school_id, staff_id, university_id, active_campus_id)
  select ca, 'staff', 'QA Central', 14, v_ca, university_id, 15 from public.school where id = 14;
  insert into public.staff (school_id, full_name, email, role) values (15, 'QA WB Office', 'qa-h-wb-office@example.com', 'office') returning id into v_wo;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (wo, 'staff', 'QA WB Office', 15, v_wo);
  select id into v_coe from public.position_title where school_id = 14 and access_type = 'exams_head' and scope_level = 'university' limit 1;
  delete from public.staff_position p using public.position_title t, public.school sc where t.id = p.title_id and sc.id = p.school_id and t.access_type = 'exams_head' and sc.university_id = (select university_id from public.school where id = 14);
  -- a campus office cannot give a university-wide position
  perform set_config('request.jwt.claims', json_build_object('sub', wo, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.assign_position(v_wo, (select id from public.position_title where school_id = 15 and access_type = 'exams_head' and scope_level = 'university' limit 1), null, null, null, null, null, false);
    exception when others then ok := true; end;
  if not ok then raise exception 'FAIL campus office gave a university-wide position'; end if;
  if not app.can_publish_results() then raise exception 'FAIL campus office cannot publish before a university CoE exists'; end if;
  reset role;
  insert into public.staff_position (school_id, staff_id, title_id) values (14, v_ca, v_coe);
  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true); set local role authenticated;
  if public.current_school_id() <> 15 or not app.has_access('exams_head') or not app.can_publish_results() then raise exception 'FAIL university CoE at another campus'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', wo, 'role', 'authenticated')::text, true); set local role authenticated;
  if app.can_publish_results() then raise exception 'FAIL campus office publishes beside a university CoE'; end if;
  if (select title from public.signatory('exams_head')) is null then raise exception 'FAIL university CoE signature'; end if;
  reset role;
end $$;
rollback;
