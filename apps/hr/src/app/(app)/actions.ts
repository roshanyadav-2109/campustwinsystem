"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCtx, ORG_COOKIE } from "@/lib/context";
import { friendly } from "@/lib/format";
import type { ActionResult } from "@/components/action-form";

// Every action runs with the signed-in person's own database session, so row
// security decides what is allowed; these checks only give clearer messages.
// Actions never call redirect(): on Cloudflare a redirect thrown from a server
// action leaves the request hanging, so an action returns { go } and the browser
// navigates (see ActionForm).

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const intOrNull = (s: string) => (s && /^\d+$/.test(s) ? Number(s) : null);
const done = (ok: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok };
};

export async function switchOrg(_: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const id = str(form, "org");
  if (!ctx.orgs.some((o) => o.id === id)) return { error: "You cannot open that organisation." };
  (await cookies()).set(ORG_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  return { go: "/home" };
}

// ------------------------------------------------------------ attendance
export async function checkIn(): Promise<ActionResult> {
  const { db, org } = await getCtx();
  const { error } = await db.rpc("check_in", { p_org: org.id });
  return error ? { error: friendly(error.message) } : done("Checked in.");
}

export async function checkOut(): Promise<ActionResult> {
  const { db, org } = await getCtx();
  const { error } = await db.rpc("check_out", { p_org: org.id });
  return error ? { error: friendly(error.message) } : done("Checked out.");
}

export async function markAttendance(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can mark attendance." };
  const employee = intOrNull(str(f, "employee_id"));
  const day = str(f, "day");
  const status = str(f, "status");
  if (!employee || !isDay(day)) return { error: "Choose an employee and a date." };
  if (status === "clear") {
    const { error } = await db.from("attendance").delete().eq("org_id", org.id).eq("employee_id", employee).eq("day", day);
    return error ? { error: friendly(error.message) } : done("Cleared.");
  }
  if (!["present", "absent", "half_day", "on_leave", "holiday"].includes(status)) return { error: "Choose a status." };
  const { error } = await db.from("attendance").upsert(
    { org_id: org.id, employee_id: employee, day, status, source: "manual" },
    { onConflict: "employee_id,day" },
  );
  return error ? { error: friendly(error.message) } : done("Saved.");
}

// ------------------------------------------------------------ leave
export async function applyLeave(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, employeeId } = await getCtx();
  if (!employeeId) return { error: "You are not set up as an employee here." };
  const type = intOrNull(str(f, "leave_type_id"));
  const from = str(f, "from_date");
  const to = str(f, "to_date") || from;
  const half = f.get("half_day") === "on";
  const reason = str(f, "reason");
  if (!type) return { error: "Choose a leave type." };
  if (!isDay(from) || !isDay(to)) return { error: "Choose the dates." };
  if (to < from) return { error: "The last day cannot be before the first day." };
  if (half && from !== to) return { error: "A half day must start and end on the same date." };
  if (!reason) return { error: "Add a short reason." };
  if (reason.length > 500) return { error: "Keep the reason under 500 characters." };
  const { error } = await db.from("leave_request").insert({
    org_id: org.id, employee_id: employeeId, leave_type_id: type,
    from_date: from, to_date: to, half_day: half, reason, days: 0, // days is worked out by the database
  });
  return error ? { error: friendly(error.message) } : done("Leave request sent for approval.");
}

export async function cancelLeave(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db } = await getCtx();
  const id = intOrNull(str(f, "id"));
  if (!id) return { error: "Request not found." };
  const { error } = await db.rpc("cancel_leave", { p_request: id });
  return error ? { error: friendly(error.message) } : done("Cancelled.");
}

export async function decideLeave(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db } = await getCtx();
  const id = intOrNull(str(f, "id"));
  const decision = str(f, "decision");
  const note = str(f, "note");
  if (!id || !["approve", "reject"].includes(decision)) return { error: "Choose approve or decline." };
  if (note.length > 500) return { error: "Keep the note under 500 characters." };
  const { error } = await db.rpc("decide_leave", { p_request: id, p_approve: decision === "approve", p_note: note || undefined });
  return error ? { error: friendly(error.message) } : done(decision === "approve" ? "Approved." : "Declined.");
}

// ------------------------------------------------------------ employees
function employeeFields(f: FormData) {
  return {
    code: str(f, "code"),
    full_name: str(f, "full_name"),
    email: str(f, "email").toLowerCase() || null,
    phone: str(f, "phone") || null,
    department_id: intOrNull(str(f, "department_id")),
    designation_id: intOrNull(str(f, "designation_id")),
    manager_id: intOrNull(str(f, "manager_id")),
    employment_type: str(f, "employment_type") || "permanent",
    date_of_joining: str(f, "date_of_joining") || null,
    gender: str(f, "gender") || null,
    date_of_birth: str(f, "date_of_birth") || null,
  };
}

function checkEmployee(e: ReturnType<typeof employeeFields>): string | null {
  if (!e.code) return "Add an employee number.";
  if (!e.full_name) return "Add the employee's name.";
  if (e.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email)) return "The email does not look right.";
  if (e.date_of_joining && !isDay(e.date_of_joining)) return "Check the joining date.";
  if (e.date_of_birth && !isDay(e.date_of_birth)) return "Check the date of birth.";
  return null;
}

export async function addEmployee(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can add employees." };
  const e = employeeFields(f);
  const bad = checkEmployee(e);
  if (bad) return { error: bad };
  const { data, error } = await db.from("employee").insert({ org_id: org.id, ...e }).select("id").single();
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { go: `/employees/${data.id}?added=1` };
}

export async function updateEmployee(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can edit employees." };
  const id = intOrNull(str(f, "id"));
  if (!id) return { error: "Employee not found." };
  const e = employeeFields(f);
  const bad = checkEmployee(e);
  if (bad) return { error: bad };
  if (e.manager_id === id) return { error: "An employee cannot report to themselves." };
  const status = str(f, "status");
  const leaving = str(f, "date_of_leaving") || null;
  if (!["active", "on_notice", "left"].includes(status)) return { error: "Choose a status." };
  if (leaving && !isDay(leaving)) return { error: "Check the leaving date." };
  const { error } = await db.from("employee").update({ ...e, status, date_of_leaving: leaving }).eq("org_id", org.id).eq("id", id);
  return error ? { error: friendly(error.message) } : done("Saved.");
}

export async function adjustLeave(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can adjust leave." };
  const employee = intOrNull(str(f, "employee_id"));
  const type = intOrNull(str(f, "leave_type_id"));
  const year = intOrNull(str(f, "year"));
  const days = Number(str(f, "days"));
  const note = str(f, "note");
  if (!employee || !type || !year) return { error: "Choose the leave type and year." };
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 366 || Math.round(days * 2) !== days * 2) return { error: "Enter days in steps of 0.5, for example 2 or -1.5." };
  if (!note) return { error: "Add a note saying why." };
  const { error } = await db.from("leave_ledger").insert({ org_id: org.id, employee_id: employee, leave_type_id: type, year, days, kind: "adjustment", note });
  return error ? { error: friendly(error.message) } : done("Balance adjusted.");
}

// ------------------------------------------------------------ organisation setup
type Named = "department" | "designation";

export async function addNamed(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can change this." };
  const table = str(f, "table") as Named;
  const name = str(f, "name");
  if (!["department", "designation"].includes(table)) return { error: "Unknown list." };
  if (!name || name.length > 120) return { error: "Add a name (up to 120 characters)." };
  const { error } = await db.from(table).insert({ org_id: org.id, name });
  return error ? { error: friendly(error.message) } : done("Added.");
}

export async function removeNamed(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can change this." };
  const table = str(f, "table") as Named;
  const id = intOrNull(str(f, "id"));
  if (!["department", "designation"].includes(table) || !id) return { error: "Not found." };
  const { error } = await db.from(table).delete().eq("org_id", org.id).eq("id", id);
  return error ? { error: friendly(error.message) } : done("Removed. Employees in it keep their record.");
}

export async function addHoliday(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can change holidays." };
  const day = str(f, "day");
  const name = str(f, "name");
  if (!isDay(day) || !name) return { error: "Choose a date and add a name." };
  const { error } = await db.from("holiday").insert({ org_id: org.id, day, name });
  return error ? { error: friendly(error.message) } : done("Holiday added.");
}

export async function removeHoliday(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can change holidays." };
  const id = intOrNull(str(f, "id"));
  if (!id) return { error: "Not found." };
  const { error } = await db.from("holiday").delete().eq("org_id", org.id).eq("id", id);
  return error ? { error: friendly(error.message) } : done("Removed.");
}

// ------------------------------------------------------------ leave policy
export async function seedLeaveTypes(): Promise<ActionResult> {
  const { db, org } = await getCtx();
  const { error } = await db.rpc("seed_defaults", { p_org: org.id });
  return error ? { error: friendly(error.message) } : done("Standard leave types added.");
}

export async function addLeaveType(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can change leave types." };
  const code = str(f, "code").toUpperCase();
  const name = str(f, "name");
  const quota = Number(str(f, "annual_quota") || "0");
  const paid = f.get("is_paid") === "on";
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(code)) return { error: "Use a short code of letters and digits, for example ML." };
  if (!name) return { error: "Add a name." };
  if (!Number.isFinite(quota) || quota < 0 || quota > 366 || Math.round(quota * 2) !== quota * 2) return { error: "Days per year must be 0 to 366, in steps of 0.5." };
  const { error } = await db.from("leave_type").insert({ org_id: org.id, code, name, annual_quota: quota, is_paid: paid, allow_negative: !paid });
  return error ? { error: friendly(error.message) } : done("Leave type added.");
}

export async function toggleLeaveType(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only HR admins can change leave types." };
  const id = intOrNull(str(f, "id"));
  const active = str(f, "active") === "1";
  if (!id) return { error: "Not found." };
  const { error } = await db.from("leave_type").update({ active }).eq("org_id", org.id).eq("id", id);
  return error ? { error: friendly(error.message) } : done(active ? "Turned on." : "Turned off.");
}

export async function allocateYear(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org } = await getCtx();
  const year = intOrNull(str(f, "year"));
  if (!year) return { error: "Choose a year." };
  const { data, error } = await db.rpc("allocate_year", { p_org: org.id, p_year: year });
  if (error) return { error: friendly(error.message) };
  return done(data ? `Added ${data} yearly allocation${data === 1 ? "" : "s"} for ${year}.` : `Everyone already has their ${year} allocation.`);
}
