// Generator for 0046_multitenant.sql — emits the tenant-isolation migration.
// Deterministic, so the migration can be regenerated/reviewed. Run: node scripts/gen-0046.mjs
import { writeFileSync } from "node:fs";

// All 56 public tables.
const ALL = [
  "absence_notice","academic_year","admission_enquiry","admission_followup","announcement",
  "assessment","assessment_type","attendance_record","bus","bus_assignment","bus_live","class",
  "class_subject","event","fee_head","fee_invoice","fee_invoice_line","fee_payment","fee_structure",
  "feedback","guardian","guardian_student","homework","homework_submission","hpc_input",
  "leave_application","library_book","library_issue","library_setting","mark","monthly_report",
  "observation","payroll_run","payslip","profile","promotion","route","route_stop","school",
  "section","slippage_flag","staff","staff_leave","staff_leave_type","staff_salary","student",
  "student_enrollment","student_transport","subject","teacher_allotment","timetable_period",
  "timetable_slot","transport_alert","trip","trip_ping","trip_stop_event",
];

const HAS_SCHOOL_ID = new Set(["bus", "route"]); // already carry school_id + FK
const TENANT = "school";                          // scoped by its own id
const NO_DEFAULT = new Set(["profile"]);          // school_id set explicitly at signup

// Tables that get a school_id column added (everything except the tenant table and the two that have it).
const ADD = ALL.filter((t) => t !== TENANT && !HAS_SCHOOL_ID.has(t));
// Tables that get a column at all (for backfill): ADD + the two existing (in case of nulls).
const BACKFILL = ALL.filter((t) => t !== TENANT);

// Global UNIQUE constraints to rescope per school: table -> [ [oldConName, newConName, cols] ]
const UNIQUE_RESCOPE = {
  academic_year:    [["academic_year_name_key", "academic_year_name_school_key", "(school_id, name)"]],
  assessment_type:  [["assessment_type_code_key", "assessment_type_code_school_key", "(school_id, code)"]],
  class:            [["class_name_key", "class_name_school_key", "(school_id, name)"],
                     ["class_level_key", "class_level_school_key", "(school_id, level)"]],
  fee_payment:      [["fee_payment_receipt_no_key", "fee_payment_receipt_no_school_key", "(school_id, receipt_no)"]],
  library_book:     [["library_book_accession_no_key", "library_book_accession_no_school_key", "(school_id, accession_no)"]],
  payroll_run:      [["payroll_run_month_key", "payroll_run_month_school_key", "(school_id, month)"]],
  staff:            [["staff_employee_code_key", "staff_employee_code_school_key", "(school_id, employee_code)"]],
  staff_leave_type: [["staff_leave_type_code_key", "staff_leave_type_code_school_key", "(school_id, code)"]],
  student:          [["student_admission_no_key", "student_admission_no_school_key", "(school_id, admission_no)"]],
  subject:          [["subject_code_key", "subject_code_school_key", "(school_id, code)"]],
  timetable_period: [["timetable_period_period_no_key", "timetable_period_period_no_school_key", "(school_id, period_no)"]],
};

let s = `-- =============================================================================
-- Migration 0046 — Multi-institution tenancy
--
-- Turns the single-school ERP into a multi-institution one. Every table gains a
-- school_id, a RESTRICTIVE policy pins every authenticated read/write to the
-- caller's own institution, and global unique keys become unique per institution.
-- The 153 existing permissive policies are UNCHANGED: restrictive policies AND
-- with them, so all role/scope logic still applies, now inside one institution.
--
-- service_role bypasses RLS, so the company console/back end still sees every
-- institution. The 20 SECURITY DEFINER functions are hardened in 0047.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add school_id (nullable) to every table that lacks it.
-- ---------------------------------------------------------------------------
alter table public.profile add column if not exists school_id bigint references public.school(id);
`;
for (const t of ADD) {
  s += `alter table public.${t} add column if not exists school_id bigint references public.school(id);\n`;
}

s += `
-- ---------------------------------------------------------------------------
-- 2. Backfill every row to the one existing institution (id 1), with triggers
--    disabled so trigger-driven inserts (e.g. on_attendance_change) do not fire
--    before school_id defaults exist. One-time; this session only.
-- ---------------------------------------------------------------------------
set session_replication_role = replica;
`;
for (const t of BACKFILL) {
  s += `update public.${t} set school_id = 1 where school_id is null;\n`;
}
s += `set session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 3. profile.school_id NOT NULL + index, then current_school_id() (reads it).
--    SECURITY DEFINER so its own read of profile is not gated by profile's RLS.
-- ---------------------------------------------------------------------------
alter table public.profile alter column school_id set not null;
create index if not exists profile_school_id_idx on public.profile (school_id);

create or replace function public.current_school_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profile where id = auth.uid()
$$;
revoke all on function public.current_school_id() from public;
grant execute on function public.current_school_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Every other table: NOT NULL, default to the caller's institution so
--    existing INSERT code auto-stamps it, and an index for the policy check.
-- ---------------------------------------------------------------------------
`;
for (const t of ADD) {
  s += `alter table public.${t} alter column school_id set not null;\n`;
  if (!NO_DEFAULT.has(t)) s += `alter table public.${t} alter column school_id set default public.current_school_id();\n`;
  s += `create index if not exists ${t}_school_id_idx on public.${t} (school_id);\n`;
}
for (const t of ["bus", "route"]) {
  s += `alter table public.${t} alter column school_id set default public.current_school_id();\n`;
  s += `create index if not exists ${t}_school_id_idx on public.${t} (school_id);\n`;
}

s += `
-- ---------------------------------------------------------------------------
-- 5. Rescope global unique keys to be unique PER institution.
-- ---------------------------------------------------------------------------
`;
// timetable_slot.period_no FKs to timetable_period.period_no — drop it before
// rescoping that unique, re-add as a composite (school_id, period_no) FK after.
s += `alter table public.timetable_slot drop constraint if exists timetable_slot_period_no_fkey;\n`;

for (const [t, rules] of Object.entries(UNIQUE_RESCOPE)) {
  for (const [oldCon, newCon, cols] of rules) {
    s += `alter table public.${t} drop constraint if exists ${oldCon};\n`;
    s += `alter table public.${t} drop constraint if exists ${newCon};\n`;
    s += `alter table public.${t} add constraint ${newCon} unique ${cols};\n`;
  }
}

s += `-- Re-add the timetable FK as composite, matching the new per-school unique.
alter table public.timetable_slot drop constraint if exists timetable_slot_school_period_fkey;
alter table public.timetable_slot add constraint timetable_slot_school_period_fkey
  foreign key (school_id, period_no) references public.timetable_period (school_id, period_no)
  on update cascade on delete cascade;
`;
s += `
-- Partial unique indexes that were global:
drop index if exists public.one_current_year;
create unique index one_current_year on public.academic_year (school_id) where is_current;
drop index if exists public.uq_fee_head_name;
create unique index uq_fee_head_name on public.fee_head (school_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- 6. Tenant isolation: one RESTRICTIVE policy per table. ANDs with every
--    existing permissive policy, so no authenticated user can read or write a
--    row outside their own institution, whatever the permissive policies allow.
-- ---------------------------------------------------------------------------
`;
for (const t of ALL) {
  const col = t === TENANT ? "id" : "school_id";
  s += `drop policy if exists tenant_isolation on public.${t};\n`;
  s += `create policy tenant_isolation on public.${t} as restrictive for all to authenticated\n`;
  s += `  using (${col} = public.current_school_id()) with check (${col} = public.current_school_id());\n`;
}

writeFileSync("supabase/migrations/0046_multitenant.sql", s);
console.log("wrote supabase/migrations/0046_multitenant.sql,", s.split("\n").length, "lines");
