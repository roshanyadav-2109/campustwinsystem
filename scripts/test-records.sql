-- Self-test for 0183 on Meridian (11): transcript requests (fee, no dues), the fuller NAAC/AISHE counts. Rolled back.
begin;
do $$ declare of uuid := gen_random_uuid(); v_off bigint; k bigint; v_req bigint; v_inv bigint; ok boolean; j jsonb; tok text;
begin
  insert into auth.users (id, email, aud, role) values (of, 'qa-rc@example.com', 'authenticated', 'authenticated');
  insert into public.staff (school_id, full_name, email, role) values (11, 'QA CoE', 'qa-rc@example.com', 'subject_teacher') returning id into v_off;
  insert into public.profile (id, role, full_name, school_id, staff_id) values (of, 'staff', 'QA CoE', 11, v_off);
  insert into public.staff_position (school_id, staff_id, title_id) select 11, v_off, id from public.position_title where school_id = 11 and access_type = 'exams_head' and scope_level in ('campus', 'university') limit 1;
  update public.school set transcript_fee = 200 where id = 11;
  -- a student with results and nothing else due
  select e.student_id into k from public.student_enrollment e join public.academic_year y on y.id = e.academic_year_id and y.is_current where e.school_id = 11 and e.status = 'active' limit 1;
  insert into public.course_result (school_id, semester_id, student_id, course_id, attempt, credits, grade, point, passed)
  values (11, (select id from public.semester where school_id = 11 order by starts_on desc limit 1), k, (select id from public.course where school_id = 11 limit 1), 1, 3, 'A', 9, true);
  if k is null then raise exception 'SETUP no student'; end if;
  update public.fee_invoice set status = 'paid' where student_id = k and status in ('due', 'part');
  update public.library_issue set returned_on = current_date where student_id = k and returned_on is null;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  v_req := public.request_transcript(k, 2, 'Higher studies', true);
  reset role;
  select invoice_id into v_inv from public.transcript_request where id = v_req;
  if (select amount from public.fee_invoice where id = v_inv) <> 400 then raise exception 'FAIL fee for two copies'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  ok := false; begin perform public.decide_transcript_request(v_req, true); exception when others then ok := sqlerrm like '%transcript fee%'; end;
  if not ok then raise exception 'FAIL issued before the fee was paid'; end if;
  reset role;
  update public.fee_invoice set status = 'paid' where id = v_inv;
  perform set_config('request.jwt.claims', json_build_object('sub', of, 'role', 'authenticated')::text, true); set local role authenticated;
  tok := public.decide_transcript_request(v_req, true);
  j := public.institution_statistics();
  reset role;
  if tok is null or (select status from public.transcript_request where id = v_req) <> 'issued' then raise exception 'FAIL not issued'; end if;
  if not (j ? 'by_category' and j ? 'intake' and j ? 'final_year' and j ? 'staff_by_qualification' and j ? 'pwd') then raise exception 'FAIL statistics keys %', left(j::text, 300); end if;
end $$;
rollback;
