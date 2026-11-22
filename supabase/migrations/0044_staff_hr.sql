-- =============================================================================
-- Migration 0044 — Staff HR: staff leave and payroll
--   staff_leave_type : the kinds of leave (CL, SL, EL, LWP) and days per year
--   staff_leave      : a staff member's leave request and its decision
--   staff_salary     : one salary structure per staff member
--   payroll_run      : one run per month (draft, then finalised)
--   payslip          : one row per staff member per run
--
-- Access
--   * staff_leave_type : every signed-in user reads; office writes.
--   * staff_leave      : a staff member reads and files their own and may cancel
--                        their own pending request; principal/office read all and
--                        decide pending requests, never their own.
--   * staff_salary     : office reads and writes; principal reads. No teachers.
--   * payroll_run      : office reads and writes (only while draft); principal
--                        reads. No teachers.
--   * payslip          : office writes (only while the run is draft); principal
--                        reads all; a staff member reads their own once the run
--                        is finalised.
-- (This is separate from leave_application, which is about STUDENT absences.)
-- Only creates new objects. Safe to run more than once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Leave types
-- ---------------------------------------------------------------------------
create table if not exists public.staff_leave_type (
  id            bigint generated always as identity primary key,
  code          text not null unique,
  name          text not null,
  days_per_year numeric(5,1) not null default 0 check (days_per_year >= 0),
  is_paid       boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Leave requests
-- ---------------------------------------------------------------------------
create table if not exists public.staff_leave (
  id               bigint generated always as identity primary key,
  staff_id         bigint not null references public.staff(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  leave_type_id    bigint not null references public.staff_leave_type(id) on delete restrict,
  from_date        date not null,
  to_date          date not null,
  days             numeric(5,1) not null,
  reason           text not null,
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by       bigint references public.staff(id) on delete set null,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz not null default now(),
  check (to_date >= from_date),
  -- Half days allowed; never more days than the dates cover.
  check (days > 0 and days <= (to_date - from_date + 1)),
  check (char_length(reason) <= 500),
  check (decision_note is null or char_length(decision_note) <= 500)
);

create index if not exists idx_staff_leave_staff_year on public.staff_leave(staff_id, academic_year_id);
create index if not exists idx_staff_leave_year_status on public.staff_leave(academic_year_id, status);
create index if not exists idx_staff_leave_type        on public.staff_leave(leave_type_id);
create index if not exists idx_staff_leave_dates       on public.staff_leave(from_date, to_date);
create index if not exists idx_staff_leave_decided_by  on public.staff_leave(decided_by);

-- ---------------------------------------------------------------------------
-- Salary structure (one per staff member). Only the last four digits of the
-- bank account are ever kept.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_salary (
  id              bigint generated always as identity primary key,
  staff_id        bigint not null unique references public.staff(id) on delete cascade,
  basic           numeric(12,2) not null default 0 check (basic >= 0),
  hra             numeric(12,2) not null default 0 check (hra >= 0),
  da              numeric(12,2) not null default 0 check (da >= 0),
  other_allowance numeric(12,2) not null default 0 check (other_allowance >= 0),
  pf_deduction    numeric(12,2) not null default 0 check (pf_deduction >= 0),
  tax_deduction   numeric(12,2) not null default 0 check (tax_deduction >= 0),
  other_deduction numeric(12,2) not null default 0 check (other_deduction >= 0),
  bank_name       text,
  account_last4   text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  effective_from  date not null default current_date,
  updated_by      bigint references public.staff(id) on delete set null,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_staff_salary_updated_by on public.staff_salary(updated_by);

-- ---------------------------------------------------------------------------
-- Payroll runs and payslips
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_run (
  id           bigint generated always as identity primary key,
  month        date not null unique check (extract(day from month) = 1),
  status       text not null default 'draft' check (status in ('draft', 'finalised')),
  created_by   bigint references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  finalised_at timestamptz
);

create index if not exists idx_payroll_run_created_by on public.payroll_run(created_by);

create table if not exists public.payslip (
  id                bigint generated always as identity primary key,
  run_id            bigint not null references public.payroll_run(id) on delete cascade,
  staff_id          bigint not null references public.staff(id) on delete cascade,
  -- Copy of payroll_run.month, so a staff member can list their own payslips
  -- by month without any access to payroll_run.
  month             date not null,
  working_days      numeric(5,1) not null default 0,
  unpaid_leave_days numeric(5,1) not null default 0,
  basic             numeric(12,2) not null default 0,
  hra               numeric(12,2) not null default 0,
  da                numeric(12,2) not null default 0,
  other_allowance   numeric(12,2) not null default 0,
  gross             numeric(12,2) not null default 0,
  pf_deduction      numeric(12,2) not null default 0,
  tax_deduction     numeric(12,2) not null default 0,
  other_deduction   numeric(12,2) not null default 0,
  lwp_deduction     numeric(12,2) not null default 0,
  net               numeric(12,2) not null default 0,
  created_at        timestamptz not null default now(),
  unique (run_id, staff_id)
);

create index if not exists idx_payslip_staff on public.payslip(staff_id, month);

-- ---------------------------------------------------------------------------
-- Helper: is this payroll run finalised? Security definer, because teachers
-- cannot read payroll_run and the payslip policies still need the answer.
-- ---------------------------------------------------------------------------
create or replace function app.payroll_run_finalised(p_run bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.payroll_run r where r.id = p_run and r.status = 'finalised');
$$;
revoke execute on function app.payroll_run_finalised(bigint) from public, anon;
grant execute on function app.payroll_run_finalised(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.staff_leave_type enable row level security;
alter table public.staff_leave      enable row level security;
alter table public.staff_salary     enable row level security;
alter table public.payroll_run      enable row level security;
alter table public.payslip          enable row level security;

-- Leave types: all read, office writes.
drop policy if exists staff_leave_type_read   on public.staff_leave_type;
drop policy if exists staff_leave_type_insert on public.staff_leave_type;
drop policy if exists staff_leave_type_update on public.staff_leave_type;
drop policy if exists staff_leave_type_delete on public.staff_leave_type;
create policy staff_leave_type_read on public.staff_leave_type
  for select to authenticated using (true);
create policy staff_leave_type_insert on public.staff_leave_type
  for insert to authenticated with check ((select app.is_office()));
create policy staff_leave_type_update on public.staff_leave_type
  for update to authenticated
  using ((select app.is_office())) with check ((select app.is_office()));
create policy staff_leave_type_delete on public.staff_leave_type
  for delete to authenticated using ((select app.is_office()));

-- Leave requests.
drop policy if exists staff_leave_read   on public.staff_leave;
drop policy if exists staff_leave_insert on public.staff_leave;
drop policy if exists staff_leave_cancel on public.staff_leave;
drop policy if exists staff_leave_decide on public.staff_leave;
create policy staff_leave_read on public.staff_leave
  for select to authenticated using (
    (select app.is_admin_scope()) or staff_id = (select app.my_staff_id())
  );
-- A staff member files their own request, always as pending and undecided.
create policy staff_leave_insert on public.staff_leave
  for insert to authenticated with check (
    staff_id = (select app.my_staff_id())
    and status = 'pending'
    and decided_by is null and decided_at is null and decision_note is null
  );
-- The owner may withdraw a request that is still pending, and nothing else.
create policy staff_leave_cancel on public.staff_leave
  for update to authenticated
  using (staff_id = (select app.my_staff_id()) and status = 'pending')
  with check (staff_id = (select app.my_staff_id()) and status = 'cancelled');
-- Principal/office decide a pending request that is not their own, and the
-- decision is recorded in their own name.
create policy staff_leave_decide on public.staff_leave
  for update to authenticated
  using (
    (select app.is_admin_scope())
    and status = 'pending'
    and staff_id is distinct from (select app.my_staff_id())
  )
  with check (
    (select app.is_admin_scope())
    and staff_id is distinct from (select app.my_staff_id())
    and status in ('approved', 'rejected')
    and decided_by = (select app.my_staff_id())
  );
-- No delete policy: leave records are kept.

-- Salary: office reads and writes, principal reads.
drop policy if exists staff_salary_read   on public.staff_salary;
drop policy if exists staff_salary_insert on public.staff_salary;
drop policy if exists staff_salary_update on public.staff_salary;
drop policy if exists staff_salary_delete on public.staff_salary;
create policy staff_salary_read on public.staff_salary
  for select to authenticated using ((select app.is_admin_scope()));
create policy staff_salary_insert on public.staff_salary
  for insert to authenticated with check ((select app.is_office()));
create policy staff_salary_update on public.staff_salary
  for update to authenticated
  using ((select app.is_office())) with check ((select app.is_office()));
create policy staff_salary_delete on public.staff_salary
  for delete to authenticated using ((select app.is_office()));

-- Payroll runs: office writes while the run is a draft; a finalised run is locked.
drop policy if exists payroll_run_read   on public.payroll_run;
drop policy if exists payroll_run_insert on public.payroll_run;
drop policy if exists payroll_run_update on public.payroll_run;
drop policy if exists payroll_run_delete on public.payroll_run;
create policy payroll_run_read on public.payroll_run
  for select to authenticated using ((select app.is_admin_scope()));
create policy payroll_run_insert on public.payroll_run
  for insert to authenticated with check ((select app.is_office()) and status = 'draft');
create policy payroll_run_update on public.payroll_run
  for update to authenticated
  using ((select app.is_office()) and status = 'draft')
  with check ((select app.is_office()));
create policy payroll_run_delete on public.payroll_run
  for delete to authenticated using ((select app.is_office()) and status = 'draft');

-- Payslips: office writes while the run is a draft; principal/office read all;
-- a staff member reads their own once the run is finalised.
drop policy if exists payslip_read   on public.payslip;
drop policy if exists payslip_insert on public.payslip;
drop policy if exists payslip_update on public.payslip;
drop policy if exists payslip_delete on public.payslip;
create policy payslip_read on public.payslip
  for select to authenticated using (
    (select app.is_admin_scope())
    or (staff_id = (select app.my_staff_id()) and app.payroll_run_finalised(run_id))
  );
create policy payslip_insert on public.payslip
  for insert to authenticated with check (
    (select app.is_office()) and not app.payroll_run_finalised(run_id)
  );
create policy payslip_update on public.payslip
  for update to authenticated
  using ((select app.is_office()) and not app.payroll_run_finalised(run_id))
  with check ((select app.is_office()) and not app.payroll_run_finalised(run_id));
create policy payslip_delete on public.payslip
  for delete to authenticated using (
    (select app.is_office()) and not app.payroll_run_finalised(run_id)
  );

grant select, insert, update, delete on public.staff_leave_type to authenticated;
grant select, insert, update         on public.staff_leave      to authenticated;
grant select, insert, update, delete on public.staff_salary     to authenticated;
grant select, insert, update, delete on public.payroll_run      to authenticated;
grant select, insert, update, delete on public.payslip          to authenticated;

-- ---------------------------------------------------------------------------
-- Default leave types. The office can change the days; existing rows are kept.
-- ---------------------------------------------------------------------------
insert into public.staff_leave_type (code, name, days_per_year, is_paid) values
  ('CL',  'Casual leave',      12, true),
  ('SL',  'Sick leave',        10, true),
  ('EL',  'Earned leave',      15, true),
  ('LWP', 'Leave without pay',  0, false)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
