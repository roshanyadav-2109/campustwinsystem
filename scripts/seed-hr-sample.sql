-- Sample HR company on the FICTIONAL sample school "greenfield" (created by
-- scripts/seed-sample.mjs and removed by scripts/clean-sample.mjs), so HR can be
-- explored without touching any real institution. No logins are linked; the
-- platform owner administers it. Runs once; does nothing if already seeded.
do $$
declare
  o uuid; y int := extract(year from hr.today())::int;
  d_admin bigint; d_acad bigint; d_acc bigint; d_tr bigint; d_fac bigint; d_lab bigint; d_lib bigint;
  g_pr bigint; g_os bigint; g_t bigint; g_acc bigint; g_drv bigint; g_lab bigint; g_sec bigint; g_hk bigint; g_lib bigint; g_cond bigint;
  e_pr bigint; e_os bigint; e_ct bigint; e_t bigint; cl bigint; sl bigint; r bigint; dd date;
begin
  if current_setting('request.jwt.claims', true) is not null and current_setting('request.jwt.claims', true) <> '' then
    raise exception 'run as the database owner';
  end if;
  select org_id into o from public.school where slug = 'greenfield' and code = 'GFP';
  if o is null then raise exception 'sample school greenfield not found'; end if;
  if exists (select 1 from hr.employee where org_id = o) then raise notice 'already seeded'; return; end if;

  insert into core.subscription (org_id, product_code, status, trial_ends_at)
  select o, 'hr', 'trial', now() + interval '60 days'
  where not exists (select 1 from core.subscription where org_id = o and product_code = 'hr' and status in ('trial','active','past_due','paused'));


  insert into hr.department (org_id, name) values (o, 'Administration') returning id into d_admin;
  insert into hr.department (org_id, name) values (o, 'Academics') returning id into d_acad;
  insert into hr.department (org_id, name) values (o, 'Accounts') returning id into d_acc;
  insert into hr.department (org_id, name) values (o, 'Transport') returning id into d_tr;
  insert into hr.department (org_id, name) values (o, 'Facilities') returning id into d_fac;
  insert into hr.department (org_id, name) values (o, 'Laboratories') returning id into d_lab;
  insert into hr.department (org_id, name) values (o, 'Library') returning id into d_lib;

  insert into hr.designation (org_id, name) values (o, 'Principal') returning id into g_pr;
  insert into hr.designation (org_id, name) values (o, 'Office superintendent') returning id into g_os;
  insert into hr.designation (org_id, name) values (o, 'Teacher') returning id into g_t;
  insert into hr.designation (org_id, name) values (o, 'Accountant') returning id into g_acc;
  insert into hr.designation (org_id, name) values (o, 'Driver') returning id into g_drv;
  insert into hr.designation (org_id, name) values (o, 'Bus conductor') returning id into g_cond;
  insert into hr.designation (org_id, name) values (o, 'Lab assistant') returning id into g_lab;
  insert into hr.designation (org_id, name) values (o, 'Security guard') returning id into g_sec;
  insert into hr.designation (org_id, name) values (o, 'Housekeeping') returning id into g_hk;
  insert into hr.designation (org_id, name) values (o, 'Librarian') returning id into g_lib;

  insert into hr.leave_type (org_id, code, name, annual_quota, is_paid, allow_negative) values
    (o, 'CL', 'Casual leave', 12, true, false), (o, 'SL', 'Sick leave', 12, true, false),
    (o, 'EL', 'Earned leave', 15, true, false), (o, 'LWP', 'Leave without pay', 0, false, true);
  select id into cl from hr.leave_type where org_id = o and code = 'CL';
  select id into sl from hr.leave_type where org_id = o and code = 'SL';

  insert into hr.employee (org_id, code, full_name, email, department_id, designation_id, employment_type, date_of_joining, gender)
    values (o, 'E-001', 'Dr. Kavita Raghunathan', null, d_admin, g_pr, 'permanent', '2014-06-02', 'female') returning id into e_pr;
  insert into hr.employee (org_id, code, full_name, email, department_id, designation_id, manager_id, employment_type, date_of_joining, gender)
    values (o, 'E-002', 'Sanjay Mehrotra', null, d_admin, g_os, e_pr, 'permanent', '2016-04-11', 'male') returning id into e_os;
  insert into hr.employee (org_id, code, full_name, email, department_id, designation_id, manager_id, employment_type, date_of_joining, gender)
    values (o, 'E-003', 'Neha Bhattacharya', null, d_acad, g_t, e_pr, 'permanent', '2018-07-01', 'female') returning id into e_ct;
  insert into hr.employee (org_id, code, full_name, email, department_id, designation_id, manager_id, employment_type, date_of_joining, gender)
    values (o, 'E-004', 'Arjun Pillai', null, d_acad, g_t, e_pr, 'permanent', '2019-06-17', 'male') returning id into e_t;
  insert into hr.employee (org_id, code, full_name, email, department_id, designation_id, manager_id, employment_type, date_of_joining, gender) values
    (o, 'E-005', 'Dinesh Chauhan', null, d_tr, g_cond, e_os, 'contract', '2021-01-04', 'male'),
    (o, 'E-006', 'Priya Nair', null, d_acc, g_acc, e_os, 'permanent', '2017-09-18', 'female'),
    (o, 'E-007', 'Suresh Patil', null, d_lab, g_lab, e_pr, 'permanent', '2020-02-03', 'male'),
    (o, 'E-008', 'Mohan Lal Yadav', null, d_fac, g_sec, e_os, 'contract', '2022-08-01', 'male'),
    (o, 'E-009', 'Lakshmi Devi', null, d_fac, g_hk, e_os, 'daily_wage', '2023-03-13', 'female'),
    (o, 'E-010', 'Harish Kumar', null, d_tr, g_drv, e_os, 'contract', '2021-01-04', 'male'),
    (o, 'E-011', 'Fatima Sheikh', null, d_lib, g_lib, e_pr, 'probation', '2026-07-01', 'female'),
    (o, 'E-012', 'Vikram Joshi', null, d_acad, g_t, e_pr, 'probation', '2026-06-15', 'male');

  insert into hr.leave_ledger (org_id, employee_id, leave_type_id, year, days, kind, note)
  select o, e.id, t.id, y, t.annual_quota, 'allocation', 'Yearly allocation'
  from hr.employee e cross join hr.leave_type t
  where e.org_id = o and t.org_id = o and t.annual_quota > 0;

  insert into hr.holiday (org_id, day, name) values
    (o, make_date(y, 12, 25), 'Christmas'), (o, make_date(y + 1, 1, 14), 'Makar Sankranti'),
    (o, make_date(y + 1, 1, 26), 'Republic Day'), (o, make_date(y + 1, 3, 4), 'Holi');

  -- the last five working days, most people present
  for dd in select g::date from generate_series(hr.today() - 7, hr.today() - 1, interval '1 day') g
            where extract(isodow from g) < 7 loop
    insert into hr.attendance (org_id, employee_id, day, check_in, check_out, status, source)
    select o, e.id, dd,
           (dd + time '08:40' + (e.id % 7) * interval '3 minutes') at time zone 'Asia/Kolkata',
           (dd + time '16:10' + (e.id % 5) * interval '4 minutes') at time zone 'Asia/Kolkata',
           case when (e.id + extract(day from dd)::int) % 11 = 0 then 'absent' else 'present' end, 'device'
    from hr.employee e where e.org_id = o;
  end loop;
  update hr.attendance set check_in = null, check_out = null where org_id = o and status = 'absent';

  -- a sick day already taken, and a casual leave waiting for the principal
  insert into hr.leave_request (org_id, employee_id, leave_type_id, from_date, to_date, reason, days)
    values (o, e_t, sl, hr.today() - 3, hr.today() - 3, 'Fever', 0) returning id into r;
  update hr.leave_request set status = 'approved', decided_at = now() - interval '4 days', decision_note = 'Get well soon' where id = r;
  insert into hr.leave_ledger (org_id, employee_id, leave_type_id, year, days, kind, request_id)
    values (o, e_t, sl, y, -1, 'leave', r);
  insert into hr.leave_request (org_id, employee_id, leave_type_id, from_date, to_date, reason, days)
    values (o, e_ct, cl, hr.today() + 9, hr.today() + 10, 'Sister''s wedding in Kolkata', 0);
  insert into hr.leave_request (org_id, employee_id, leave_type_id, from_date, to_date, half_day, reason, days)
    select o, e.id, cl, hr.today() + 4, hr.today() + 4, true, 'Bank work', 0 from hr.employee e where e.org_id = o and e.code = 'E-006';
end $$;
