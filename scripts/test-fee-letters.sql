-- Self-test for 0071 on Greenfield (school 8), acting as a sample parent and
-- the sample office through their own row rules. Rolled back.
begin;
do $$
declare v_parent uuid; v_child bigint; v_other bigint; v_office uuid; v_year bigint; v_id bigint; v_no text; n int; ok boolean;
begin
  -- temporary parent and office logins (rolled back with everything else)
  select gs.student_id into v_child from public.guardian_student gs where gs.school_id = 8 limit 1;
  select e.student_id into v_other from public.student_enrollment e join public.section s on s.id = e.section_id
   where s.school_id = 8 and e.student_id not in (select gs2.student_id from public.guardian_student gs1 join public.guardian_student gs2 on gs2.guardian_id = gs1.guardian_id where gs1.student_id = v_child) limit 1;
  v_parent := gen_random_uuid(); v_office := gen_random_uuid();
  insert into auth.users (id, email, aud, role) values (v_parent, 'qa-parent-letters@example.com', 'authenticated', 'authenticated'), (v_office, 'qa-office-letters@example.com', 'authenticated', 'authenticated');
  insert into public.profile (id, role, full_name, school_id, guardian_id)
    select v_parent, 'guardian', 'QA Parent', 8, gs.guardian_id from public.guardian_student gs where gs.student_id = v_child limit 1;
  with st as (insert into public.staff (school_id, full_name, email, role) values (8, 'QA Office', 'qa-office-letters@example.com', 'office') returning id)
  insert into public.profile (id, role, full_name, school_id, staff_id) select v_office, 'staff', 'QA Office', 8, id from st;
  select id into v_year from public.academic_year where school_id = 8 and is_current;
  if v_parent is null or v_office is null then raise exception 'FAIL setup: parent % office %', v_parent, v_office; end if;

  -- parent asks for their own child
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.fee_letter_request (student_id, academic_year_id, purpose, addressed_to, status, letter_no)
  values (v_child, v_year, 'education_loan', 'QA Bank', 'issued', 'FAKE') returning id into v_id;
  select status, letter_no into v_no, v_no from public.fee_letter_request where id = v_id;
  if (select status from public.fee_letter_request where id = v_id) <> 'pending' or (select letter_no from public.fee_letter_request where id = v_id) is not null then
    raise exception 'FAIL a parent could set the status or number';
  end if;
  -- not for someone else's child
  ok := false;
  begin
    insert into public.fee_letter_request (student_id, academic_year_id, purpose) values (v_other, v_year, 'other');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL a parent asked for another child'; end if;
  -- a parent cannot issue it
  update public.fee_letter_request set status = 'issued', content = '{}'::jsonb where id = v_id;
  if (select status from public.fee_letter_request where id = v_id) <> 'pending' then raise exception 'FAIL a parent issued a letter'; end if;
  -- one open request at a time
  ok := false;
  begin
    insert into public.fee_letter_request (student_id, academic_year_id, purpose) values (v_child, v_year, 'visa');
  exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL two open requests'; end if;
  reset role;

  -- office issues it: a number is given and it cannot be changed after
  perform set_config('request.jwt.claims', json_build_object('sub', v_office, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.fee_letter_request set status = 'issued', content = '{"total": 1}'::jsonb where id = v_id;
  select letter_no into v_no from public.fee_letter_request where id = v_id;
  if v_no !~ '^FL-[0-9]{4}-[0-9]{4}$' then raise exception 'FAIL letter number %', v_no; end if;
  ok := false;
  begin
    update public.fee_letter_request set content = '{"total": 2}'::jsonb where id = v_id;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL an issued letter was changed'; end if;
  reset role;

  -- parent sees it; the loan payment type is accepted
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.fee_letter_request where id = v_id and status = 'issued';
  if n <> 1 then raise exception 'FAIL parent cannot see the issued letter'; end if;
  reset role;
  insert into public.fee_payment (school_id, invoice_id, amount, mode, reference)
    select 8, i.id, 1, 'loan', 'QA Bank 123' from public.fee_invoice i where i.school_id = 8 and i.status in ('due','part') limit 1;
end $$;
rollback;
