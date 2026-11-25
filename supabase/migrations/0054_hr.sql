-- Eternity HR, first release: organisation structure, employees, holidays,
-- leave (types, requests, approvals, ledger) and attendance.
--
-- Access, per organisation that has a live `hr` subscription in core:
--   * HR admins: the organisation's owner and admins (core.membership.role) and
--     anyone on hr.team. They see and manage everything in that organisation.
--   * Managers see their direct reports' records and decide their leave.
--   * Every employee linked to a login sees their own records.
-- Every row carries org_id, and composite foreign keys make it impossible to
-- point at a department, manager or leave type of another organisation.
-- Idempotent: safe to run twice.

begin;

create schema if not exists hr;

-- ------------------------------------------------------------ tables
create table if not exists hr.team (
  org_id     uuid not null references core.organisation(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists hr.department (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references core.organisation(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (org_id, id)
);

create table if not exists hr.designation (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references core.organisation(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (org_id, id)
);

create table if not exists hr.employee (
  id               bigint generated always as identity primary key,
  org_id           uuid not null references core.organisation(id) on delete cascade,
  code             text not null check (char_length(btrim(code)) between 1 and 30),
  full_name        text not null check (char_length(btrim(full_name)) between 1 and 150),
  email            text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            text check (phone is null or char_length(phone) <= 20),
  user_id          uuid references auth.users(id) on delete set null,
  department_id    bigint,
  designation_id   bigint,
  manager_id       bigint,
  employment_type  text not null default 'permanent'
                     check (employment_type in ('permanent', 'probation', 'contract', 'intern', 'part_time', 'daily_wage')),
  date_of_joining  date,
  date_of_leaving  date,
  status           text not null default 'active' check (status in ('active', 'on_notice', 'left')),
  gender           text check (gender is null or gender in ('female', 'male', 'other')),
  date_of_birth    date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, id),
  foreign key (org_id, department_id)  references hr.department (org_id, id)  on delete set null (department_id),
  foreign key (org_id, designation_id) references hr.designation (org_id, id) on delete set null (designation_id),
  foreign key (org_id, manager_id)     references hr.employee (org_id, id)    on delete set null (manager_id),
  check (manager_id is null or manager_id <> id),
  check (date_of_leaving is null or date_of_joining is null or date_of_leaving >= date_of_joining)
);
create unique index if not exists employee_org_email on hr.employee (org_id, lower(email)) where email is not null;
create unique index if not exists employee_org_user  on hr.employee (org_id, user_id) where user_id is not null;
create index if not exists employee_user    on hr.employee (user_id) where user_id is not null;
create index if not exists employee_manager on hr.employee (manager_id) where manager_id is not null;

create table if not exists hr.holiday (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references core.organisation(id) on delete cascade,
  day        date not null,
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  unique (org_id, day)
);

create table if not exists hr.leave_type (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references core.organisation(id) on delete cascade,
  code           text not null check (code ~ '^[A-Z][A-Z0-9]{0,9}$'),
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  annual_quota   numeric(5,1) not null default 0 check (annual_quota >= 0 and annual_quota <= 366),
  is_paid        boolean not null default true,
  allow_negative boolean not null default false,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, id)
);

create table if not exists hr.leave_request (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references core.organisation(id) on delete cascade,
  employee_id    bigint not null,
  leave_type_id  bigint not null,
  from_date      date not null,
  to_date        date not null,
  half_day       boolean not null default false,
  days           numeric(5,1) not null,
  reason         text not null check (char_length(btrim(reason)) between 1 and 500),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text check (decision_note is null or char_length(decision_note) <= 500),
  created_at     timestamptz not null default now(),
  foreign key (org_id, employee_id)   references hr.employee (org_id, id)   on delete cascade,
  foreign key (org_id, leave_type_id) references hr.leave_type (org_id, id),
  check (to_date >= from_date),
  check (not half_day or from_date = to_date),
  check (to_date - from_date <= 366)
);
create index if not exists leave_request_org_status on hr.leave_request (org_id, status, from_date);
create index if not exists leave_request_employee   on hr.leave_request (employee_id, from_date);

-- Signed entries: allocations add, approved leave subtracts, cancellations of
-- approved leave add back, adjustments correct. Balance = sum. Never edited.
create table if not exists hr.leave_ledger (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references core.organisation(id) on delete cascade,
  employee_id   bigint not null,
  leave_type_id bigint not null,
  year          integer not null check (year between 2000 and 2100),
  days          numeric(6,1) not null check (days <> 0),
  kind          text not null check (kind in ('allocation', 'leave', 'reversal', 'adjustment')),
  request_id    bigint references hr.leave_request(id),
  note          text check (note is null or char_length(note) <= 300),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (org_id, employee_id)   references hr.employee (org_id, id)   on delete cascade,
  foreign key (org_id, leave_type_id) references hr.leave_type (org_id, id),
  check ((kind in ('leave', 'reversal')) = (request_id is not null))
);
create unique index if not exists leave_ledger_one_allocation
  on hr.leave_ledger (employee_id, leave_type_id, year) where kind = 'allocation';
create index if not exists leave_ledger_balance on hr.leave_ledger (employee_id, leave_type_id, year);

create table if not exists hr.attendance (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references core.organisation(id) on delete cascade,
  employee_id bigint not null,
  day         date not null,
  check_in    timestamptz,
  check_out   timestamptz,
  status      text not null default 'present'
                check (status in ('present', 'absent', 'half_day', 'on_leave', 'holiday')),
  source      text not null default 'manual' check (source in ('self', 'manual', 'device')),
  note        text check (note is null or char_length(note) <= 300),
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  foreign key (org_id, employee_id) references hr.employee (org_id, id) on delete cascade,
  unique (employee_id, day),
  check (check_out is null or check_in is null or check_out >= check_in)
);
create index if not exists attendance_org_day on hr.attendance (org_id, day);

-- ------------------------------------------------------------ access helpers
-- All SECURITY DEFINER with an empty search_path; they read core, which signed-in
-- users cannot read directly.
create or replace function hr.subscribed(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.subscription s
    where s.org_id = p_org and s.product_code = 'hr' and s.status in ('trial', 'active', 'past_due'))
$$;

-- The Eternity platform owners (public.platform_owner, matched on the sign-in
-- email) administer HR in every organisation that has it, for support.
create or replace function hr.is_platform_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_owner po
    join auth.users u on lower(u.email) = lower(po.email)
    where u.id = auth.uid())
$$;

create or replace function hr.is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select hr.subscribed(p_org) and (
    hr.is_platform_owner()
    or exists (select 1 from core.membership m
             where m.org_id = p_org and m.user_id = auth.uid()
               and m.status = 'active' and m.role in ('owner', 'admin'))
    or exists (select 1 from hr.team t where t.org_id = p_org and t.user_id = auth.uid()))
$$;

create or replace function hr.my_employee(p_org uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select e.id from hr.employee e
  where e.org_id = p_org and e.user_id = auth.uid() and e.status <> 'left'
    and hr.subscribed(p_org)
  limit 1
$$;

-- Organisations the signed-in person may open HR for.
create or replace function hr.my_orgs() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from core.organisation o
  where o.status = 'active' and hr.subscribed(o.id)
    and (hr.is_admin(o.id) or hr.my_employee(o.id) is not null)
$$;

create or replace function hr.manages(p_employee bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from hr.employee e
    where e.id = p_employee and e.manager_id is not null
      and e.manager_id = hr.my_employee(e.org_id))
$$;

create or replace function hr.can_see_employee(p_org uuid, p_employee bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select hr.is_admin(p_org)
      or p_employee = hr.my_employee(p_org)
      or hr.manages(p_employee)
$$;

-- Today in India, the date attendance and leave are counted in.
create or replace function hr.today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ------------------------------------------------------------ triggers
create or replace function hr.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists employee_touch on hr.employee;
create trigger employee_touch before update on hr.employee for each row execute function hr.touch();

-- Link an employee to the login that has the same email, and make that login a
-- member of the organisation with access to HR.
create or replace function hr.employee_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_member uuid;
begin
  if new.email is not null then
    new.email := lower(btrim(new.email));
  end if;
  if new.user_id is null and new.email is not null then
    select u.id into new.user_id from auth.users u where lower(u.email) = new.email limit 1;
  end if;
  if new.user_id is not null then
    insert into core.membership (org_id, user_id) values (new.org_id, new.user_id)
    on conflict (org_id, user_id) do update set status = core.membership.status
    returning id into v_member;
    insert into core.product_access (membership_id, product_code) values (v_member, 'hr')
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists employee_link on hr.employee;
create trigger employee_link before insert or update of email, user_id on hr.employee
  for each row execute function hr.employee_link();

-- Leave requests: work out the days and refuse overlaps and inactive types.
create or replace function hr.leave_request_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.employee_id, new.leave_type_id, new.from_date, new.to_date, new.half_day)
       is distinct from (old.employee_id, old.leave_type_id, old.from_date, old.to_date, old.half_day) then
    raise exception 'A leave request cannot be changed after it is made; cancel it and apply again';
  end if;
  new.days := case when new.half_day then 0.5 else (new.to_date - new.from_date + 1) end;
  if tg_op = 'INSERT' then
    if not exists (select 1 from hr.leave_type t where t.id = new.leave_type_id and t.org_id = new.org_id and t.active) then
      raise exception 'This leave type is not available';
    end if;
    if exists (select 1 from hr.leave_request r
               where r.employee_id = new.employee_id and r.status in ('pending', 'approved')
                 and r.from_date <= new.to_date and r.to_date >= new.from_date) then
      raise exception 'These dates overlap another leave request';
    end if;
    new.status := 'pending';
    new.decided_by := null; new.decided_at := null; new.decision_note := null;
  end if;
  return new;
end $$;
drop trigger if exists leave_request_check on hr.leave_request;
create trigger leave_request_check before insert or update on hr.leave_request
  for each row execute function hr.leave_request_check();

-- Direct edits are refused; rows may only disappear when their employee or
-- organisation is deleted (a cascade, which runs one trigger level deeper).
create or replace function hr.ledger_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Leave ledger entries cannot be changed; add an adjustment instead';
end $$;
drop trigger if exists leave_ledger_append_only on hr.leave_ledger;
create trigger leave_ledger_append_only before update or delete on hr.leave_ledger
  for each row execute function hr.ledger_append_only();

-- ------------------------------------------------------------ views
create or replace view hr.leave_balance with (security_invoker = true) as
  select org_id, employee_id, leave_type_id, year, sum(days)::numeric(7,1) as balance
  from hr.leave_ledger
  group by org_id, employee_id, leave_type_id, year;

-- ------------------------------------------------------------ actions
-- Approve or reject a pending request. Admins and the employee's manager may
-- decide; nobody decides their own request except the organisation's owner.
create or replace function hr.decide_leave(p_request bigint, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r hr.leave_request;
  t hr.leave_type;
  v_owner boolean;
  v_bal numeric;
  v_year int;
begin
  select * into r from hr.leave_request where id = p_request for update;
  if not found then raise exception 'Leave request not found'; end if;
  if not (hr.is_admin(r.org_id) or hr.manages(r.employee_id)) then
    raise exception 'You cannot decide this request';
  end if;
  if r.status <> 'pending' then raise exception 'This request has already been decided'; end if;
  select exists (select 1 from core.membership m where m.org_id = r.org_id and m.user_id = auth.uid() and m.role = 'owner')
         or hr.is_platform_owner()
    into v_owner;
  if exists (select 1 from hr.employee e where e.id = r.employee_id and e.user_id = auth.uid()) and not v_owner then
    raise exception 'You cannot decide your own leave request';
  end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'Note is too long'; end if;

  if p_approve then
    select * into t from hr.leave_type where id = r.leave_type_id;
    v_year := extract(year from r.from_date)::int;
    if t.is_paid and not t.allow_negative then
      select coalesce(sum(days), 0) into v_bal from hr.leave_ledger
       where employee_id = r.employee_id and leave_type_id = r.leave_type_id and year = v_year;
      if v_bal < r.days then
        raise exception 'Not enough % balance: % day(s) left, % requested', t.name, v_bal, r.days;
      end if;
    end if;
    insert into hr.leave_ledger (org_id, employee_id, leave_type_id, year, days, kind, request_id, created_by)
    values (r.org_id, r.employee_id, r.leave_type_id, v_year, -r.days, 'leave', r.id, auth.uid());
  end if;

  update hr.leave_request
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = r.id;
end $$;

-- Cancel a request: pending ones any time; approved ones only before they start
-- (the days go back to the balance).
create or replace function hr.cancel_leave(p_request bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare r hr.leave_request;
begin
  select * into r from hr.leave_request where id = p_request for update;
  if not found then raise exception 'Leave request not found'; end if;
  if not (hr.is_admin(r.org_id) or r.employee_id = hr.my_employee(r.org_id)) then
    raise exception 'You cannot cancel this request';
  end if;
  if r.status = 'pending' then
    null;
  elsif r.status = 'approved' and r.from_date > hr.today() then
    insert into hr.leave_ledger (org_id, employee_id, leave_type_id, year, days, kind, request_id, created_by)
    values (r.org_id, r.employee_id, r.leave_type_id, extract(year from r.from_date)::int, r.days, 'reversal', r.id, auth.uid());
  else
    raise exception 'Only pending requests, or approved leave that has not started, can be cancelled';
  end if;
  update hr.leave_request set status = 'cancelled' where id = r.id;
end $$;

-- Give every active employee their yearly quota of each leave type, once.
create or replace function hr.allocate_year(p_org uuid, p_year int)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not hr.is_admin(p_org) then raise exception 'Only HR admins can allocate leave'; end if;
  if p_year not between 2000 and 2100 then raise exception 'Invalid year'; end if;
  insert into hr.leave_ledger (org_id, employee_id, leave_type_id, year, days, kind, note, created_by)
  select p_org, e.id, t.id, p_year, t.annual_quota, 'allocation', 'Yearly allocation', auth.uid()
  from hr.employee e
  cross join hr.leave_type t
  where e.org_id = p_org and e.status <> 'left'
    and t.org_id = p_org and t.active and t.annual_quota > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Mark today's arrival or departure for the signed-in employee.
create or replace function hr.check_in(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp bigint := hr.my_employee(p_org);
begin
  if v_emp is null then raise exception 'You are not an employee of this organisation'; end if;
  insert into hr.attendance as a (org_id, employee_id, day, check_in, status, source, updated_by)
  values (p_org, v_emp, hr.today(), now(), 'present', 'self', auth.uid())
  on conflict (employee_id, day) do update
    set check_in = coalesce(a.check_in, excluded.check_in),
        status = case when a.status = 'absent' then 'present' else a.status end,
        updated_by = excluded.updated_by, updated_at = now();
end $$;

create or replace function hr.check_out(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp bigint := hr.my_employee(p_org);
begin
  if v_emp is null then raise exception 'You are not an employee of this organisation'; end if;
  update hr.attendance set check_out = now(), updated_by = auth.uid(), updated_at = now()
   where employee_id = v_emp and day = hr.today() and check_in is not null and check_out is null;
  if not found then raise exception 'Check in first'; end if;
end $$;

-- Common Indian leave types, so a new organisation can start at once.
create or replace function hr.seed_defaults(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr.is_admin(p_org) then raise exception 'Only HR admins can set up HR'; end if;
  insert into hr.leave_type (org_id, code, name, annual_quota, is_paid, allow_negative) values
    (p_org, 'CL',  'Casual leave',      12, true,  false),
    (p_org, 'SL',  'Sick leave',        12, true,  false),
    (p_org, 'EL',  'Earned leave',      15, true,  false),
    (p_org, 'LWP', 'Leave without pay',  0, false, true)
  on conflict (org_id, code) do nothing;
end $$;

-- ------------------------------------------------------------ row security
alter table hr.team          enable row level security;
alter table hr.department    enable row level security;
alter table hr.designation   enable row level security;
alter table hr.employee      enable row level security;
alter table hr.holiday       enable row level security;
alter table hr.leave_type    enable row level security;
alter table hr.leave_request enable row level security;
alter table hr.leave_ledger  enable row level security;
alter table hr.attendance    enable row level security;

do $$
declare t text;
begin
  -- organisation-wide reference lists: everyone in HR reads, admins write
  foreach t in array array['department', 'designation', 'holiday', 'leave_type'] loop
    execute format('drop policy if exists %1$s_read on hr.%1$s', t);
    execute format('create policy %1$s_read on hr.%1$s for select to authenticated using (org_id in (select hr.my_orgs()))', t);
    execute format('drop policy if exists %1$s_write on hr.%1$s', t);
    execute format('create policy %1$s_write on hr.%1$s for all to authenticated using (hr.is_admin(org_id)) with check (hr.is_admin(org_id))', t);
  end loop;
end $$;

drop policy if exists team_read on hr.team;
create policy team_read on hr.team for select to authenticated using (hr.is_admin(org_id));
drop policy if exists team_write on hr.team;
create policy team_write on hr.team for all to authenticated
  using (exists (select 1 from core.membership m where m.org_id = hr.team.org_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')))
  with check (exists (select 1 from core.membership m where m.org_id = hr.team.org_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')));

drop policy if exists employee_read on hr.employee;
create policy employee_read on hr.employee for select to authenticated
  using (hr.can_see_employee(org_id, id));
drop policy if exists employee_write on hr.employee;
create policy employee_write on hr.employee for all to authenticated
  using (hr.is_admin(org_id)) with check (hr.is_admin(org_id));

drop policy if exists leave_request_read on hr.leave_request;
create policy leave_request_read on hr.leave_request for select to authenticated
  using (hr.can_see_employee(org_id, employee_id));
drop policy if exists leave_request_apply on hr.leave_request;
create policy leave_request_apply on hr.leave_request for insert to authenticated
  with check (employee_id = hr.my_employee(org_id) or hr.is_admin(org_id));

drop policy if exists leave_ledger_read on hr.leave_ledger;
create policy leave_ledger_read on hr.leave_ledger for select to authenticated
  using (hr.can_see_employee(org_id, employee_id));
drop policy if exists leave_ledger_adjust on hr.leave_ledger;
create policy leave_ledger_adjust on hr.leave_ledger for insert to authenticated
  with check (hr.is_admin(org_id) and kind in ('allocation', 'adjustment'));

drop policy if exists attendance_read on hr.attendance;
create policy attendance_read on hr.attendance for select to authenticated
  using (hr.can_see_employee(org_id, employee_id));
drop policy if exists attendance_write on hr.attendance;
create policy attendance_write on hr.attendance for all to authenticated
  using (hr.is_admin(org_id)) with check (hr.is_admin(org_id));

-- ------------------------------------------------------------ grants
revoke all on schema hr from public, anon;
revoke all on all tables    in schema hr from public, anon;
revoke all on all sequences in schema hr from public, anon;
revoke all on all functions in schema hr from public, anon;
alter default privileges in schema hr revoke all on tables    from public, anon;
alter default privileges in schema hr revoke all on sequences from public, anon;
alter default privileges in schema hr revoke all on functions from public, anon;

grant usage on schema hr to authenticated, service_role;
grant select, insert, update, delete on all tables in schema hr to authenticated, service_role;
grant usage, select on all sequences in schema hr to authenticated, service_role;
revoke update, delete on hr.leave_ledger from authenticated;
revoke update, delete on hr.leave_request from authenticated;
grant execute on function
  hr.is_platform_owner(), hr.subscribed(uuid), hr.is_admin(uuid), hr.my_employee(uuid), hr.my_orgs(), hr.manages(bigint),
  hr.can_see_employee(uuid, bigint), hr.today(),
  hr.decide_leave(bigint, boolean, text), hr.cancel_leave(bigint), hr.allocate_year(uuid, int),
  hr.check_in(uuid), hr.check_out(uuid), hr.seed_defaults(uuid)
  to authenticated, service_role;

-- Links into reference rows (accounts, parties, leave types, requests) are
-- checked when the change is saved (DEFERRABLE INITIALLY DEFERRED): deleting a
-- row that is still in use is still refused, but removing a whole organisation
-- cascades cleanly whatever order Postgres deletes the rows in.
do $fix$
declare c record;
begin
  for c in select conrelid::regclass as t, conname, pg_get_constraintdef(oid) as def
           from pg_constraint where connamespace = 'hr'::regnamespace and contype = 'f' and confdeltype = 'r' loop
    execute format('alter table %s drop constraint %I, add constraint %I %s', c.t, c.conname, c.conname, replace(c.def, ' ON DELETE RESTRICT', ''));
  end loop;
  for c in select conrelid::regclass as t, conname
           from pg_constraint where connamespace = 'hr'::regnamespace and contype = 'f' and confdeltype = 'a' and not condeferrable loop
    execute format('alter table %s alter constraint %I deferrable initially deferred', c.t, c.conname);
  end loop;
end $fix$;

commit;
