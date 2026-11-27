-- Self-test for 0172 on Meridian (11): results import, transcripts, statistics. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_off bigint; v_sem bigint; k bigint; v_adm text; v_c1 text; v_c2 text; n int; tok text; ok boolean; j jsonb; v record;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-tr-of@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA Office', 'qa-tr-of@example.com', 'office') returning id into v_off;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA Office', 11, v_off);
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_off, id from public.position_title where school_id = 11 and access_type = 'exams_head' and scope_level in ('campus', 'university') limit 1;
  select id into v_sem from public.semester where school_id = 11 order by starts_on desc limit 1;
  select st.id, st.admission_no into k, v_adm from public.student st join public.student_enrollment e on e.student_id = st.id and e.status = 'active' where st.school_id = 11 limit 1;
  select code into v_c1 from public.course where school_id = 11 and code is not null order by id limit 1;
  select code into v_c2 from public.course where school_id = 11 and code is not null order by id offset 1 limit 1;
  delete from public.course_result where student_id = k and semester_id = v_sem;
  delete from public.semester_result where student_id = k and semester_id = v_sem;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  -- an unknown row is refused naming it
  ok := false; begin perform public.import_university_results(v_sem, jsonb_build_array(jsonb_build_object('admission_no', 'NOPE-1', 'course_code', v_c1, 'grade', 'A', 'point', 9)));
  exception when others then ok := sqlerrm like '%NOPE-1%'; end;
  if not ok then raise exception 'FAIL unknown row not named'; end if;
  n := public.import_university_results(v_sem, jsonb_build_array(
    jsonb_build_object('admission_no', v_adm, 'course_code', v_c1, 'grade', 'A', 'point', 9, 'passed', true),
    jsonb_build_object('admission_no', v_adm, 'course_code', v_c2, 'grade', 'F', 'point', 0, 'passed', false)));
  if n <> 2 then raise exception 'FAIL imported % rows', n; end if;
  reset role;
  select sgpa, backlogs, published_as into v from public.semester_result where student_id = k and semester_id = v_sem;
  if v.sgpa is null or v.backlogs <> 1 or v.published_as <> 'Imported from the university' then raise exception 'FAIL semester line %', row_to_json(v); end if;
  -- importing again replaces, not duplicates
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  perform public.import_university_results(v_sem, jsonb_build_array(jsonb_build_object('admission_no', v_adm, 'course_code', v_c2, 'grade', 'B', 'point', 7, 'passed', true)));
  reset role;
  if (select count(*) from public.course_result where student_id = k and semester_id = v_sem) <> 2 then raise exception 'FAIL re-import duplicated'; end if;
  if (select backlogs from public.semester_result where student_id = k and semester_id = v_sem) <> 0 then raise exception 'FAIL re-import did not clear the backlog'; end if;
  -- transcript issued and verified publicly
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  tok := public.issue_transcript(k);
  j := public.institution_statistics();
  reset role;
  if (j ->> 'students')::int = 0 or j -> 'by_programme' is null then raise exception 'FAIL statistics %', left(j::text, 200); end if;
  set local role anon;
  select * into v from public.verify_transcript(tok);
  reset role;
  if not coalesce(v.valid, false) or v.cgpa is null then raise exception 'FAIL transcript check %', row_to_json(v); end if;
end $$;
rollback;
