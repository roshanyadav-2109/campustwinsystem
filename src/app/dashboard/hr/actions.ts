"use server";
import { revalidatePath } from "next/cache";
import { getSession, getCurrentYear } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";
import {
  isIsoDate, leaveDaysWithin, monthBounds, schoolDate, spanDays, workingDaysBetween,
  type LeaveType, type Salary, type StaffLeave,
} from "@/lib/data/hr";

export type Result = { ok: true } | { ok: false; error: string };

const PATH = "/dashboard/hr";
const fail = (error: string): Result => ({ ok: false, error });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const posInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const trimDays = (d: number) => String(Math.round(d * 10) / 10);

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

// Days of this type the staff member has already used up this year.
async function usedDays(staffId: number, yearId: number, typeId: number, statuses: string[], exceptId?: number): Promise<number | null> {
  const db = await untyped();
  const { data, error } = await db.from("staff_leave").select("id, days")
    .eq("staff_id", staffId).eq("academic_year_id", yearId).eq("leave_type_id", typeId).in("status", statuses);
  if (error) return null;
  return ((data ?? []) as { id: number; days: number }[]).filter((r) => r.id !== exceptId).reduce((s, r) => s + num(r.days), 0);
}

export async function applyStaffLeave(input: { typeId: number; fromDate: string; toDate: string; halfDay: boolean; reason: string }): Promise<Result> {
  const session = await getSession();
  if (!session?.staffId) return fail("Only staff can apply for leave.");
  const year = await getCurrentYear();
  if (!year) return fail("No school year is open yet.");

  const typeId = posInt(input?.typeId);
  if (!typeId) return fail("Choose a leave type.");
  const from = input?.fromDate, to = input?.toDate;
  if (!isIsoDate(from) || !isIsoDate(to)) return fail("Enter the first and last day of the leave.");
  if (to < from) return fail("The last day cannot be before the first day.");
  if (spanDays(from, to) > 90) return fail("A single request can cover at most 90 days.");
  const halfDay = input?.halfDay === true;
  if (halfDay && from !== to) return fail("A half day can only be taken on a single date.");
  const reason = text(input?.reason, 500);
  if (reason.length < 3) return fail("Give a short reason for the leave.");

  // Sundays and whole-school holidays on the calendar are not counted as leave.
  const db = await untyped();
  const { data: hols } = await db.from("event").select("start_date, end_date")
    .eq("event_type", "holiday").is("class_id", null).is("section_id", null)
    .lte("start_date", to).gte("end_date", from);
  const holidays = new Set<string>();
  for (const h of (hols ?? []) as { start_date: string; end_date: string | null }[]) {
    for (let t = Date.parse(`${h.start_date}T00:00:00Z`), e = Date.parse(`${h.end_date ?? h.start_date}T00:00:00Z`); t <= e; t += 86_400_000) {
      holidays.add(new Date(t).toISOString().slice(0, 10));
    }
  }
  const working = workingDaysBetween(from, to, holidays);
  if (working === 0) return fail("Those dates are Sundays or school holidays, so no leave is needed.");
  const days = halfDay ? 0.5 : working;

  const { data: typeRow } = await db.from("staff_leave_type").select("id, code, name, days_per_year, is_paid").eq("id", typeId).maybeSingle();
  const type = typeRow as LeaveType | null;
  if (!type) return fail("That leave type was not found.");

  const { data: clash, error: clashErr } = await db.from("staff_leave").select("id")
    .eq("staff_id", session.staffId).in("status", ["pending", "approved"])
    .lte("from_date", to).gte("to_date", from).limit(1);
  if (clashErr) return fail("Your leave could not be checked. Please try again.");
  if (clash?.length) return fail("You already have a pending or approved leave on these dates.");

  if (type.is_paid) {
    // Requests still waiting count too, so the balance cannot be over-booked.
    const used = await usedDays(session.staffId, year.id, type.id, ["pending", "approved"]);
    if (used === null) return fail("Your leave balance could not be checked. Please try again.");
    const left = Math.max(0, num(type.days_per_year) - used);
    if (days > left) {
      return fail(`You have ${trimDays(left)} ${type.name.toLowerCase()} day(s) left, counting requests still waiting. This request needs ${trimDays(days)}.`);
    }
  }

  const { error } = await db.from("staff_leave").insert({
    staff_id: session.staffId,
    academic_year_id: year.id,
    leave_type_id: type.id,
    from_date: from,
    to_date: to,
    days,
    reason,
    status: "pending",
  });
  if (error) return fail("The leave request could not be saved. Please try again.");
  revalidatePath(PATH);
  return { ok: true };
}

export async function cancelStaffLeave(id: number): Promise<Result> {
  const session = await getSession();
  if (!session?.staffId) return fail("Not permitted.");
  const leaveId = posInt(id);
  if (!leaveId) return fail("That request was not found.");
  const db = await untyped();
  const { data, error } = await db.from("staff_leave").update({ status: "cancelled" })
    .eq("id", leaveId).eq("staff_id", session.staffId).eq("status", "pending").select("id");
  if (error) return fail("The request could not be cancelled. Please try again.");
  if (!data?.length) return fail("Only a request that is still pending can be cancelled.");
  revalidatePath(PATH);
  return { ok: true };
}

export async function decideStaffLeave(id: number, status: "approved" | "rejected", note?: string): Promise<Result> {
  const session = await getSession();
  if (!session?.staffId || !session.isAdminScope) return fail("Only the principal or office can decide leave.");
  const leaveId = posInt(id);
  if (!leaveId) return fail("That request was not found.");
  if (status !== "approved" && status !== "rejected") return fail("Choose approve or reject.");
  const decisionNote = text(note, 500) || null;

  const db = await untyped();
  const { data: row } = await db.from("staff_leave")
    .select("id, staff_id, academic_year_id, leave_type_id, days, status").eq("id", leaveId).maybeSingle();
  const leave = row as Pick<StaffLeave, "id" | "staff_id" | "academic_year_id" | "leave_type_id" | "days" | "status"> | null;
  if (!leave) return fail("That request was not found.");
  if (leave.staff_id === session.staffId) return fail("You cannot decide your own leave. Someone else must do it.");
  if (leave.status !== "pending") return fail("This request has already been decided or cancelled.");

  if (status === "approved") {
    const { data: typeRow } = await db.from("staff_leave_type").select("id, code, name, days_per_year, is_paid").eq("id", leave.leave_type_id).maybeSingle();
    const type = typeRow as LeaveType | null;
    if (!type) return fail("That leave type was not found.");
    if (type.is_paid) {
      const taken = await usedDays(leave.staff_id, leave.academic_year_id, type.id, ["approved"], leave.id);
      if (taken === null) return fail("The leave balance could not be checked. Please try again.");
      const left = Math.max(0, num(type.days_per_year) - taken);
      if (num(leave.days) > left) return fail(`Only ${trimDays(left)} ${type.name.toLowerCase()} day(s) are left, so this cannot be approved.`);
    }
  }

  const { data, error } = await db.from("staff_leave")
    .update({ status, decided_by: session.staffId, decided_at: new Date().toISOString(), decision_note: decisionNote })
    .eq("id", leaveId).eq("status", "pending").neq("staff_id", session.staffId).select("id");
  if (error) return fail("The decision could not be saved. Please try again.");
  if (!data?.length) return fail("This request has already been decided or cancelled.");
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Salary structure (office only)
// ---------------------------------------------------------------------------
export type SalaryInput = {
  staffId: number;
  basic: number; hra: number; da: number; otherAllowance: number;
  pfDeduction: number; taxDeduction: number; otherDeduction: number;
  bankName: string; accountLast4: string; effectiveFrom: string;
};

// Money is handled in whole paise so nothing drifts by a fraction.
const MAX_PAISE = 9_999_999_999; // numeric(12,2) holds a little more than this
function paise(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  const p = Math.round(v * 100);
  return p > MAX_PAISE ? null : p;
}
const rupees = (p: number) => p / 100;

export async function saveSalary(input: SalaryInput): Promise<Result> {
  const session = await getSession();
  if (!session?.staffId || session.staffRole !== "office") return fail("Only the office can change salary details.");
  const staffId = posInt(input?.staffId);
  if (!staffId) return fail("Choose a staff member.");

  const fields = {
    basic: paise(input.basic), hra: paise(input.hra), da: paise(input.da), other_allowance: paise(input.otherAllowance),
    pf_deduction: paise(input.pfDeduction), tax_deduction: paise(input.taxDeduction), other_deduction: paise(input.otherDeduction),
  };
  for (const v of Object.values(fields)) if (v === null) return fail("Enter every amount as a number, zero or more.");
  const f = fields as Record<keyof typeof fields, number>;
  const gross = f.basic + f.hra + f.da + f.other_allowance;
  if (gross === 0) return fail("Enter at least the basic pay.");
  if (f.pf_deduction + f.tax_deduction + f.other_deduction > gross) return fail("The deductions cannot be more than the total earnings.");

  const bankName = text(input.bankName, 80) || null;
  const last4 = typeof input.accountLast4 === "string" ? input.accountLast4.trim() : "";
  if (last4 && !/^\d{4}$/.test(last4)) return fail("Enter only the last 4 digits of the account number.");
  if (!isIsoDate(input.effectiveFrom)) return fail("Enter the date this salary applies from.");

  const db = await untyped();
  const { data: person } = await db.from("staff").select("id").eq("id", staffId).maybeSingle();
  if (!person) return fail("That staff member was not found.");

  const { error } = await db.from("staff_salary").upsert({
    staff_id: staffId,
    basic: rupees(f.basic), hra: rupees(f.hra), da: rupees(f.da), other_allowance: rupees(f.other_allowance),
    pf_deduction: rupees(f.pf_deduction), tax_deduction: rupees(f.tax_deduction), other_deduction: rupees(f.other_deduction),
    bank_name: bankName,
    account_last4: last4 || null,
    effective_from: input.effectiveFrom,
    updated_by: session.staffId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "staff_id" });
  if (error) return fail("The salary details could not be saved. Please try again.");
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Payroll (office only). Every figure is worked out here from the salary
// structures and approved unpaid leave; nothing is taken from the browser
// except which month to prepare.
// ---------------------------------------------------------------------------
export async function preparePayroll(month: string): Promise<Result> {
  const session = await getSession();
  if (!session?.staffId || session.staffRole !== "office") return fail("Only the office can prepare payroll.");
  const bounds = typeof month === "string" ? monthBounds(month) : null;
  if (!bounds) return fail("Choose a month.");
  if (bounds.start > schoolDate()) return fail("Payroll can be prepared for this month or an earlier one.");

  const db = await untyped();
  const { data: existing, error: runErr } = await db.from("payroll_run").select("id, status").eq("month", bounds.start).maybeSingle();
  if (runErr) return fail("Payroll could not be opened. Please try again.");
  let run = existing as { id: number; status: string } | null;
  if (run?.status === "finalised") return fail("This month is finalised and can no longer be changed.");

  // Read everything needed before touching the draft.
  const [salaryRes, typeRes] = await Promise.all([
    db.from("staff_salary").select("staff_id, basic, hra, da, other_allowance, pf_deduction, tax_deduction, other_deduction, effective_from")
      .lte("effective_from", bounds.end),
    db.from("staff_leave_type").select("id").eq("is_paid", false),
  ]);
  if (salaryRes.error || typeRes.error) return fail("Salary details could not be read. Please try again.");
  const salaries = (salaryRes.data ?? []) as Pick<Salary, "staff_id" | "basic" | "hra" | "da" | "other_allowance" | "pf_deduction" | "tax_deduction" | "other_deduction">[];
  if (!salaries.length) return fail("No staff member has a salary set up for this month. Add salaries first.");

  const unpaidTypeIds = ((typeRes.data ?? []) as { id: number }[]).map((t) => t.id);
  const unpaid = new Map<number, number>();
  if (unpaidTypeIds.length) {
    const { data: leaves, error: leaveErr } = await db.from("staff_leave").select("staff_id, from_date, to_date, days")
      .eq("status", "approved").in("leave_type_id", unpaidTypeIds)
      .lte("from_date", bounds.end).gte("to_date", bounds.start);
    if (leaveErr) return fail("Leave records could not be read. Please try again.");
    for (const l of (leaves ?? []) as { staff_id: number; from_date: string; to_date: string; days: number }[]) {
      const d = leaveDaysWithin({ ...l, days: num(l.days) }, bounds.start, bounds.end);
      if (d > 0) unpaid.set(l.staff_id, (unpaid.get(l.staff_id) ?? 0) + d);
    }
  }

  const workingDays = workingDaysBetween(bounds.start, bounds.end);

  if (!run) {
    const { data: made, error } = await db.from("payroll_run")
      .insert({ month: bounds.start, status: "draft", created_by: session.staffId }).select("id, status").single();
    if (error || !made) return fail("Payroll for this month could not be started. Someone else may have just started it; please reload.");
    run = made as { id: number; status: string };
  } else {
    // Re-prepare: clear the draft's payslips and work them out again.
    const { error } = await db.from("payslip").delete().eq("run_id", run.id);
    if (error) return fail("The earlier draft could not be cleared. Please try again.");
  }
  const runId = run.id;

  const rows = salaries.map((s) => {
    const basic = Math.round(num(s.basic) * 100), hra = Math.round(num(s.hra) * 100), da = Math.round(num(s.da) * 100);
    const other = Math.round(num(s.other_allowance) * 100);
    const pf = Math.round(num(s.pf_deduction) * 100), tax = Math.round(num(s.tax_deduction) * 100), otherDed = Math.round(num(s.other_deduction) * 100);
    const unpaidDays = Math.min(unpaid.get(s.staff_id) ?? 0, bounds.days);
    const gross = basic + hra + da + other;
    // (basic + DA) / days in the month x unpaid days, to the nearest paisa.
    const lwp = Math.round(((basic + da) * unpaidDays) / bounds.days);
    const net = gross - pf - tax - otherDed - lwp;
    return {
      run_id: runId,
      staff_id: s.staff_id,
      month: bounds.start,
      working_days: workingDays,
      unpaid_leave_days: unpaidDays,
      basic: rupees(basic), hra: rupees(hra), da: rupees(da), other_allowance: rupees(other),
      gross: rupees(gross),
      pf_deduction: rupees(pf), tax_deduction: rupees(tax), other_deduction: rupees(otherDed),
      lwp_deduction: rupees(lwp),
      net: rupees(net),
    };
  });

  const { error: insErr } = await db.from("payslip").insert(rows);
  if (insErr) {
    revalidatePath(PATH);
    return fail("The payslips could not be saved. The draft is empty; press Prepare payroll again.");
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function finalisePayroll(month: string): Promise<Result> {
  const session = await getSession();
  if (!session?.staffId || session.staffRole !== "office") return fail("Only the office can finalise payroll.");
  const bounds = typeof month === "string" ? monthBounds(month) : null;
  if (!bounds) return fail("Choose a month.");

  const db = await untyped();
  const { data: runRow } = await db.from("payroll_run").select("id, status").eq("month", bounds.start).maybeSingle();
  const run = runRow as { id: number; status: string } | null;
  if (!run) return fail("Prepare payroll for this month first.");
  if (run.status === "finalised") return fail("This month is already finalised.");

  const { count, error: countErr } = await db.from("payslip").select("id", { count: "exact", head: true }).eq("run_id", run.id);
  if (countErr) return fail("The payslips could not be checked. Please try again.");
  if (!count) return fail("There are no payslips in this draft. Prepare payroll first.");

  const { data, error } = await db.from("payroll_run")
    .update({ status: "finalised", finalised_at: new Date().toISOString() })
    .eq("id", run.id).eq("status", "draft").select("id");
  if (error) return fail("Payroll could not be finalised. Please try again.");
  if (!data?.length) return fail("This month is already finalised.");
  revalidatePath(PATH);
  return { ok: true };
}
