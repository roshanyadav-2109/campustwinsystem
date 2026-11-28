import { untyped, isMissingTable } from "@/lib/data/schedule";

// Staff HR data (migration 0044): staff leave, salary structures, payroll.
// The generated database types do not know these tables yet, so queries go
// through the untyped client and results are cast to the row types below.
// What each person gets back is decided by the database's row rules: a teacher
// only ever receives their own leave and their own finalised payslips.

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export type LeaveType = { id: number; code: string; name: string; days_per_year: number; is_paid: boolean; active: boolean };

export type StaffLeave = {
  id: number;
  staff_id: number;
  academic_year_id: number;
  leave_type_id: number;
  from_date: string;
  to_date: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  step?: string | null;
  step_log?: { step: string; name?: string; ok: boolean; note?: string; at: string; override?: boolean }[] | null;
};

export type StaffRef = { id: number; full_name: string; role: string; employee_code: string | null };

export type Salary = {
  staff_id: number;
  basic: number;
  hra: number;
  da: number;
  other_allowance: number;
  pf_deduction: number;
  tax_deduction: number;
  other_deduction: number;
  bank_name: string | null;
  account_last4: string | null;
  effective_from: string;
  updated_at: string;
};

export type PayrollRun = { id: number; month: string; status: "draft" | "finalised"; created_at: string; finalised_at: string | null };

export type Payslip = {
  id: number;
  run_id: number;
  staff_id: number;
  month: string;
  working_days: number;
  unpaid_leave_days: number;
  basic: number;
  hra: number;
  da: number;
  other_allowance: number;
  gross: number;
  pf_deduction: number;
  tax_deduction: number;
  other_deduction: number;
  lwp_deduction: number;
  net: number;
};

const LEAVE_COLS = "id, staff_id, academic_year_id, leave_type_id, from_date, to_date, days, reason, status, decided_by, decided_at, decision_note, created_at, step, step_log";
const SALARY_COLS = "staff_id, basic, hra, da, other_allowance, pf_deduction, tax_deduction, other_deduction, bank_name, account_last4, effective_from, updated_at";
const PAYSLIP_COLS = "id, run_id, staff_id, month, working_days, unpaid_leave_days, basic, hra, da, other_allowance, gross, pf_deduction, tax_deduction, other_deduction, lwp_deduction, net";

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

const asLeave = (r: StaffLeave): StaffLeave => ({ ...r, days: n(r.days) });
const asSalary = (r: Salary): Salary => ({
  ...r, basic: n(r.basic), hra: n(r.hra), da: n(r.da), other_allowance: n(r.other_allowance),
  pf_deduction: n(r.pf_deduction), tax_deduction: n(r.tax_deduction), other_deduction: n(r.other_deduction),
});
const asPayslip = (r: Payslip): Payslip => ({
  ...r, working_days: n(r.working_days), unpaid_leave_days: n(r.unpaid_leave_days),
  basic: n(r.basic), hra: n(r.hra), da: n(r.da), other_allowance: n(r.other_allowance), gross: n(r.gross),
  pf_deduction: n(r.pf_deduction), tax_deduction: n(r.tax_deduction), other_deduction: n(r.other_deduction),
  lwp_deduction: n(r.lwp_deduction), net: n(r.net),
});

// ---------------------------------------------------------------------------
// Dates. Everything works on plain "YYYY-MM-DD" strings in UTC so the server's
// own time zone never shifts a day.
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(utc(s)) === s;
}

/** Today's date at the school (India time). */
export function schoolDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Calendar days from `from` to `to`, both included. */
export function spanDays(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS) + 1;
}

/** Days from `from` to `to` (both included) that are not Sundays. */
/** Days between two dates that are neither Sundays nor school holidays. */
export function workingDaysBetween(from: string, to: string, holidays?: Set<string>): number {
  let count = 0;
  for (let t = utc(from), end = utc(to); t <= end; t += DAY_MS) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && !holidays?.has(d.toISOString().slice(0, 10))) count++;
  }
  return count;
}

/** "YYYY-MM" -> first day, last day and number of days of that month. */
export function monthBounds(ym: string): { start: string; end: string; days: number } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null;
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  if (y < 2000 || y > 2100) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(days).padStart(2, "0")}`, days };
}

/** How many of a leave's days fall inside [start, end]. */
export function leaveDaysWithin(l: { from_date: string; to_date: string; days: number }, start: string, end: string): number {
  if (l.to_date < start || l.from_date > end) return 0;
  // One-day leave: its own figure (a half day stays a half day).
  if (l.from_date === l.to_date) return l.days;
  return workingDaysBetween(l.from_date > start ? l.from_date : start, l.to_date < end ? l.to_date : end);
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

// The leave types. `missing` = migration 0044 has not been applied yet.
export async function getLeaveTypes(): Promise<{ missing: true } | { missing: false; types: LeaveType[] }> {
  const db = await untyped();
  const { data, error } = await db.from("staff_leave_type").select("id, code, name, days_per_year, is_paid, active").order("id");
  if (error) {
    if (isMissingTable(error) || /staff_leave_type/i.test(error.message ?? "")) return { missing: true };
    throw new Error(error.message);
  }
  return { missing: false, types: ((data ?? []) as LeaveType[]).map((t) => ({ ...t, days_per_year: n(t.days_per_year), active: t.active !== false })) };
}

// One staff member's leave for a school year, newest first.
export async function getStaffLeave(staffId: number, yearId: number): Promise<StaffLeave[]> {
  const db = await untyped();
  const { data, error } = await db.from("staff_leave").select(LEAVE_COLS)
    .eq("staff_id", staffId).eq("academic_year_id", yearId)
    .order("from_date", { ascending: false }).order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as StaffLeave[]).map(asLeave);
}

// Every leave request of the year (principal/office; others only get their own).
export async function getLeaveRequests(yearId: number, status: LeaveStatus | "all"): Promise<StaffLeave[]> {
  const db = await untyped();
  let q = db.from("staff_leave").select(LEAVE_COLS).eq("academic_year_id", yearId);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as StaffLeave[]).map(asLeave);
  // Pending first, then the newest.
  return rows.sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
}

// Approved days so far this year, keyed "staffId:typeId".
export async function getApprovedDays(yearId: number): Promise<Map<string, number>> {
  const db = await untyped();
  const { data, error } = await db.from("staff_leave").select("staff_id, leave_type_id, days")
    .eq("academic_year_id", yearId).eq("status", "approved");
  if (error) throw new Error(error.message);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { staff_id: number; leave_type_id: number; days: number }[]) {
    const k = `${r.staff_id}:${r.leave_type_id}`;
    out.set(k, (out.get(k) ?? 0) + n(r.days));
  }
  return out;
}

// Approved leave that covers the given day.
export async function getOnLeave(date: string): Promise<StaffLeave[]> {
  const db = await untyped();
  const { data, error } = await db.from("staff_leave").select(LEAVE_COLS)
    .eq("status", "approved").lte("from_date", date).gte("to_date", date).order("from_date");
  if (error) throw new Error(error.message);
  return ((data ?? []) as StaffLeave[]).map(asLeave);
}

// ---------------------------------------------------------------------------
// Staff, salary, payroll
// ---------------------------------------------------------------------------
export async function getStaffList(): Promise<StaffRef[]> {
  const db = await untyped();
  const { data, error } = await db.from("staff").select("id, full_name, role, employee_code").order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffRef[];
}

export async function getSalaries(): Promise<Salary[]> {
  const db = await untyped();
  const { data, error } = await db.from("staff_salary").select(SALARY_COLS);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Salary[]).map(asSalary);
}

export async function getPayrollRuns(): Promise<PayrollRun[]> {
  const db = await untyped();
  const { data, error } = await db.from("payroll_run").select("id, month, status, created_at, finalised_at")
    .order("month", { ascending: false }).limit(36);
  if (error) throw new Error(error.message);
  return (data ?? []) as PayrollRun[];
}

export async function getRunPayslips(runId: number): Promise<Payslip[]> {
  const db = await untyped();
  const { data, error } = await db.from("payslip").select(PAYSLIP_COLS).eq("run_id", runId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Payslip[]).map(asPayslip);
}

// A staff member's own payslips. The row rules only release finalised months;
// the principal and office can also read drafts, so those are left out here by
// checking the run.
export async function getMyPayslips(staffId: number, canSeeRuns: boolean): Promise<Payslip[]> {
  const db = await untyped();
  const { data, error } = await db.from("payslip").select(PAYSLIP_COLS).eq("staff_id", staffId)
    .order("month", { ascending: false }).limit(60);
  if (error) throw new Error(error.message);
  let rows = ((data ?? []) as Payslip[]).map(asPayslip);
  if (canSeeRuns && rows.length) {
    const { data: runs, error: runErr } = await db.from("payroll_run").select("id")
      .eq("status", "finalised").in("id", [...new Set(rows.map((r) => r.run_id))]);
    if (runErr) throw new Error(runErr.message);
    const done = new Set(((runs ?? []) as { id: number }[]).map((r) => r.id));
    rows = rows.filter((r) => done.has(r.run_id));
  }
  return rows;
}
