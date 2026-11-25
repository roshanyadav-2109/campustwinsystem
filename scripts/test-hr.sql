-- Eternity HR self-test. Acts as three real logins (an HR admin, an employee,
-- and the admin of another organisation) inside one transaction that always
-- ends with an exception, so nothing is kept. Success: 'HR_TEST_PASSED'.
-- Run: SUPABASE_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> node scripts/apply-sql.mjs scripts/test-hr.sql
do $$
declare
  ua uuid; ub uuid; uc uuid; eb text;
  o1 uuid; o2 uuid; o3 uuid;
  d1 bigint; d2 bigint; ea bigint; e2 bigint; cl bigint; sl bigint; r1 bigint; r2 bigint;
  n int; v numeric; t timestamptz;
begin
  select id into ua from auth.users order by created_at limit 1;
  select id, email into ub, eb from auth.users where id <> ua and email is not null order by created_at limit 1;
  select id into uc from auth.users where id not in (ua, ub) order by created_at limit 1;
  if uc is null then raise exception 'SETUP: need three logins on this project'; end if;

  -- organisations: o1 and o2 have HR, o3 does not
  insert into core.organisation (name, kind) values ('HR Test One', 'business') returning id into o1;
  insert into core.organisation (name, kind) values ('HR Test Two', 'business') returning id into o2;
  insert into core.organisation (name, kind) values ('HR Test Three', 'business') returning id into o3;
  insert into core.subscription (org_id, product_code, status) values (o1, 'hr', 'active'), (o2, 'hr', 'active');
  insert into core.membership (org_id, user_id, role) values (o1, ua, 'owner'), (o2, uc, 'owner'), (o3, uc, 'owner');
  insert into hr.department (org_id, name) values (o2, 'Other Org Dept') returning id into d2;

  -- ------------------------------------------------------------ as A (owner of o1)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if not hr.is_admin(o1) then raise exception 'FAIL 1: owner is not HR admin'; end if;
  perform hr.seed_defaults(o1);
  select count(*) into n from hr.leave_type where org_id = o1;
  if n <> 4 then raise exception 'FAIL 1: % default leave types', n; end if;
  select id into cl from hr.leave_type where org_id = o1 and code = 'CL';
  select id into sl from hr.leave_type where org_id = o1 and code = 'SL';

  insert into hr.department (org_id, name) values (o1, 'Administration') returning id into d1;
  insert into hr.employee (org_id, code, full_name, user_id, department_id) values (o1, 'E1', 'Admin Person', ua, d1) returning id into ea;
  insert into hr.employee (org_id, code, full_name, email, department_id, manager_id)
    values (o1, 'E2', 'Staff Person', upper(eb), d1, ea) returning id into e2;
  select count(*) into n from hr.employee where id = e2 and user_id = ub and email = lower(eb);
  if n <> 1 then raise exception 'FAIL 2: employee not linked to login by email'; end if;

  -- 3. composite keys stop a department of another organisation
  begin
    insert into hr.employee (org_id, code, full_name, department_id) values (o1, 'E9', 'Wrong Dept', d2);
    raise exception 'FAIL 3: department of another organisation accepted';
  exception when foreign_key_violation then null;
  end;

  select hr.allocate_year(o1, extract(year from hr.today() + 10)::int) into n;
  if n <> 6 then raise exception 'FAIL 4: % allocations, expected 6', n; end if;
  select hr.allocate_year(o1, extract(year from hr.today() + 10)::int) into n;
  if n <> 0 then raise exception 'FAIL 4: allocation ran twice (% rows)', n; end if;
  reset role;

  -- ------------------------------------------------------------ as B (employee of o1)
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if hr.is_admin(o1) then raise exception 'FAIL 5: employee is HR admin'; end if;
  select count(*) into n from hr.employee;
  if n <> 1 then raise exception 'FAIL 5: employee sees % employee rows', n; end if;
  select count(*) into n from (select hr.my_orgs()) x;
  if n <> 1 then raise exception 'FAIL 5: employee has % HR organisations', n; end if;

  insert into hr.leave_request (org_id, employee_id, leave_type_id, from_date, to_date, reason)
    values (o1, e2, cl, hr.today() + 10, hr.today() + 12, 'Family function') returning id, days into r1, v;
  if v <> 3 then raise exception 'FAIL 6: leave days %', v; end if;

  begin
    insert into hr.leave_request (org_id, employee_id, leave_type_id, from_date, to_date, reason)
      values (o1, e2, sl, hr.today() + 12, hr.today() + 13, 'Overlap');
    raise exception 'FAIL 7: overlapping leave accepted';
  exception when raise_exception then
    if sqlerrm not like '%overlap%' then raise; end if;
  end;

  begin
    insert into hr.leave_request (org_id, employee_id, leave_type_id, from_date, to_date, reason)
      values (o1, ea, cl, hr.today() + 20, hr.today() + 20, 'For my manager');
    raise exception 'FAIL 8: employee applied leave for someone else';
  exception when insufficient_privilege then null;
  end;

  begin
    perform hr.decide_leave(r1, true, null);
    raise exception 'FAIL 9: employee decided a request';
  exception when raise_exception then
    if sqlerrm not like '%cannot decide%' then raise; end if;
  end;

  begin
    insert into hr.leave_ledger (org_id, employee_id, leave_type_id, year, days, kind) values (o1, e2, cl, 2030, 50, 'adjustment');
    raise exception 'FAIL 10: employee added leave to their own balance';
  exception when insufficient_privilege then null;
  end;

  perform hr.check_in(o1);
  select check_in into t from hr.attendance where employee_id = e2 and day = hr.today();
  perform hr.check_in(o1);
  select count(*) into n from hr.attendance where employee_id = e2 and day = hr.today() and check_in = t;
  if n <> 1 then raise exception 'FAIL 11: second check-in changed the first time'; end if;
  perform hr.check_out(o1);
  select count(*) into n from hr.attendance where employee_id = e2 and check_out is not null;
  if n <> 1 then raise exception 'FAIL 11: check-out not recorded'; end if;

  insert into hr.leave_request (org_id, employee_id, leave_type_id, from_date, to_date, reason)
    values (o1, e2, sl, hr.today() + 30, hr.today() + 49, 'Long sick leave') returning id into r2;
  reset role;

  -- ------------------------------------------------------------ as A again: decisions
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform hr.decide_leave(r1, true, 'Enjoy');
  select balance into v from hr.leave_balance where employee_id = e2 and leave_type_id = cl;
  if v <> 9 then raise exception 'FAIL 12: CL balance after approval is %', v; end if;

  begin
    perform hr.decide_leave(r2, true, null);
    raise exception 'FAIL 13: approved more sick leave than the balance';
  exception when raise_exception then
    if sqlerrm not like 'Not enough%' then raise; end if;
  end;
  perform hr.decide_leave(r2, false, 'Please apply in parts');
  begin
    perform hr.decide_leave(r2, true, null);
    raise exception 'FAIL 13: a decided request was decided again';
  exception when raise_exception then
    if sqlerrm not like '%already been decided%' then raise; end if;
  end;
  reset role;

  -- B cancels the approved future leave; the days come back
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform hr.cancel_leave(r1);
  select balance into v from hr.leave_balance where employee_id = e2 and leave_type_id = cl;
  if v <> 12 then raise exception 'FAIL 14: CL balance after cancelling is %', v; end if;
  begin
    update hr.leave_request set status = 'approved' where id = r2;
    raise exception 'FAIL 15: employee changed a request directly';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ------------------------------------------------------------ as C (admin of another organisation)
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from hr.employee where org_id = o1;
  if n <> 0 then raise exception 'FAIL 16: other organisation sees % employees', n; end if;
  select count(*) into n from hr.leave_request where org_id = o1;
  if n <> 0 then raise exception 'FAIL 16: other organisation sees leave requests'; end if;
  begin
    insert into hr.employee (org_id, code, full_name) values (o1, 'X1', 'Intruder');
    raise exception 'FAIL 17: other organisation added an employee';
  exception when insufficient_privilege then null;
  end;
  begin
    perform hr.decide_leave(r2, true, null);
    raise exception 'FAIL 17: other organisation decided leave';
  exception when raise_exception then
    if sqlerrm not like '%cannot decide%' then raise; end if;
  end;
  if hr.is_admin(o3) then raise exception 'FAIL 18: HR admin without an HR subscription'; end if;
  reset role;

  -- ------------------------------------------------------------ the public
  begin
    set local role anon;
    perform 1 from hr.employee limit 1;
    raise exception 'FAIL 19: anon can read HR';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 20. the ledger refuses edits but an organisation can still be removed
  begin
    update hr.leave_ledger set days = 99 where employee_id = e2;
    raise exception 'FAIL 20: ledger row edited';
  exception when raise_exception then
    if sqlerrm not like '%cannot be changed%' then raise; end if;
  end;
  delete from core.organisation where id = o1;
  select count(*) into n from hr.leave_ledger where org_id = o1;
  if n <> 0 then raise exception 'FAIL 20: ledger left after organisation removed'; end if;

  raise exception 'HR_TEST_PASSED';
end $$;
