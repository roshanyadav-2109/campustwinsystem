-- Self-test for 0185 on Westbridge (university 2: campuses 14, 15): a transfer asked by the campus and approved
-- centrally with a course mapping and an order number; the catalogue pushed with updates; an exam copied. Rolled back.
begin;
do $$ declare cu uuid := gen_random_uuid(); ou uuid := gen_random_uuid(); v_ca bigint; v_of bigint; k bigint; v_sec bigint; v_req bigint; j jsonb;
  v_c1 bigint; v_c2 bigint; v_sem bigint; v_prog text; v_sess bigint; v_type bigint; v_new bigint;
begin
  insert into auth.users (id, email, aud, role) values (cu, 'qa-uw-c@example.com', 'authenticated', 'authenticated'), (ou, 'qa-uw-o@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (14, 'QA Central', 'qa-uw-c@example.com', 'office') returning id into v_ca;
  insert into public.profile (id, role, full_name, school_id, staff_id, university_id, active_campus_id) values (cu, 'staff', 'QA Central', 14, v_ca, 2, 14);
  insert into public.staff (school_id, full_name, email, role) values (14, 'QA Office', 'qa-uw-o@example.com', 'office') returning id into v_of;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (ou, 'staff', 'QA Office', 14, v_of);
  -- a North student with a programme; City gets that programme on one class
  select st.id into k from public.student st join public.student_enrollment e on e.student_id = st.id and e.status = 'active'
    join public.section s2 on s2.id = e.section_id join public.class c2 on c2.id = s2.class_id where st.school_id = 14 and st.status = 'active' and c2.programme_id is not null limit 1;
  update public.fee_invoice set status = 'paid' where student_id = k and status in ('due', 'part');
  update public.library_issue set returned_on = current_date where student_id = k and returned_on is null;
  delete from public.hostel_allocation where student_id = k;
  select g.code into v_prog from public.student_enrollment e join public.section s2 on s2.id = e.section_id join public.class c2 on c2.id = s2.class_id join public.programme g on g.id = c2.programme_id where e.student_id = k and e.status = 'active' limit 1;
  insert into public.programme (school_id, code, name, level, regulation, years, semesters) select 15, code, name, level, regulation, years, semesters from public.programme where school_id = 14 and code = v_prog
    on conflict do nothing;
  select id into v_sec from public.section where school_id = 15 limit 1;
  update public.class set programme_id = (select id from public.programme where school_id = 15 and code = v_prog limit 1) where id = (select class_id from public.section where id = v_sec);
  -- a result at North in a course whose City equivalent has a different code
  select id into v_sem from public.semester where school_id = 14 order by starts_on desc limit 1;
  insert into public.course (school_id, code, name, credits) values (14, 'QA-N101', 'QA Course North', 3) returning id into v_c1;
  insert into public.course (school_id, code, name, credits) values (15, 'QA-C101', 'QA Course City', 3) returning id into v_c2;
  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, grade, point, passed) values (14, v_sem, k, v_c1, 1, 3, 'A', 9, true);
  -- the semester exists at City too (same year and kind)
  if not exists (select 1 from public.semester ts join public.academic_year ty on ty.id = ts.academic_year_id join public.semester fs on fs.id = v_sem join public.academic_year fy on fy.id = fs.academic_year_id
                 where ts.school_id = 15 and ts.kind = fs.kind and ty.name = fy.name) then
    insert into public.semester (school_id, academic_year_id, kind, starts_on, ends_on)
    select 15, ty.id, fs.kind, fs.starts_on, fs.ends_on from public.semester fs join public.academic_year fy on fy.id = fs.academic_year_id join public.academic_year ty on ty.school_id = 15 and ty.name = fy.name where fs.id = v_sem;
  end if;

  -- the campus office asks
  perform set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true); set local role authenticated;
  v_req := public.request_campus_transfer(k, 15, 'QA family moved');
  reset role;
  -- central administration maps the course and approves
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true); set local role authenticated;
  if (select suggested from public.transfer_mapping(k, 15) where from_course_id = v_c1) is not null then raise exception 'FAIL a different code was suggested'; end if;
  j := public.decide_transfer_request(v_req, true, v_sec, jsonb_build_array(jsonb_build_object('from_course_id', v_c1, 'to_course_id', v_c2)), 'QA approved', true);
  reset role;
  if (j ->> 'order_no') not like 'TO-%' then raise exception 'FAIL no transfer order %', j; end if;
  if not exists (select 1 from public.course_result where student_id = (j ->> 'student_id')::bigint and course_id = v_c2) then raise exception 'FAIL the mapped course was not carried'; end if;
  if (select status from public.transfer_request where id = v_req) <> 'approved' then raise exception 'FAIL request not approved'; end if;

  -- the catalogue pushed with updates
  update public.course set name = 'QA Course City (old name)' where id = v_c2;
  insert into public.course (school_id, code, name, credits) values (14, 'QA-C101', 'QA Course City', 4);
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true); set local role authenticated;
  j := public.copy_catalogue(14, 15, true);
  reset role;
  if (select credits from public.course where id = v_c2) <> 4 or (select name from public.course where id = v_c2) <> 'QA Course City' then raise exception 'FAIL catalogue update %', j; end if;

  -- a common exam copied from North to City
  select id into v_type from public.assessment_type where school_id = 14 and exists (select 1 from public.assessment_type t2 where t2.school_id = 15 and t2.code = assessment_type.code) limit 1;
  if v_type is not null then
    insert into public.exam_session (school_id, academic_year_id, name, term, assessment_type_id) values (14, (select id from public.academic_year where school_id = 14 and is_current), 'QA Common Exam', 1, v_type) returning id into v_sess;
    perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true); set local role authenticated;
    j := public.copy_exam_session(v_sess, 15);
    reset role;
    if not exists (select 1 from public.exam_session where id = (j ->> 'session_id')::bigint and school_id = 15 and name = 'QA Common Exam') then raise exception 'FAIL exam not copied'; end if;
  end if;
end $$;
rollback;
