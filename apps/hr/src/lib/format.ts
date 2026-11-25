// Dates are kept as plain YYYY-MM-DD and shown in Indian style; times are shown
// in India time.
const IST = "Asia/Kolkata";

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(day: string | null | undefined): string {
  if (!day) return "";
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtShort(day: string): string {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
}

export function fmtDays(n: number): string {
  const v = Number(n);
  return `${v % 1 ? v.toFixed(1) : v} day${v === 1 ? "" : "s"}`;
}

export const EMPLOYMENT_TYPES = [
  ["permanent", "Permanent"],
  ["probation", "On probation"],
  ["contract", "Contract"],
  ["intern", "Intern"],
  ["part_time", "Part time"],
  ["daily_wage", "Daily wage"],
] as const;
export const employmentLabel = (v: string) => EMPLOYMENT_TYPES.find(([k]) => k === v)?.[1] ?? v;

export const STATUS_LABEL: Record<string, string> = { active: "Active", on_notice: "On notice", left: "Left" };
export const ATTENDANCE_LABEL: Record<string, string> = {
  present: "Present", absent: "Absent", half_day: "Half day", on_leave: "On leave", holiday: "Holiday",
};
export const LEAVE_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for approval", approved: "Approved", rejected: "Declined", cancelled: "Cancelled",
};

// Database errors arrive as text; show the readable part, never internals.
export function friendly(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Please try again.";
  if (/duplicate key.*employee_org_email|employee_org_email/.test(message)) return "Another employee already uses this email.";
  if (/duplicate key.*\(org_id, code\)|employee_org_id_code_key/.test(message)) return "Another employee already has this employee number.";
  if (/duplicate key.*department|department_org_id_name_key/.test(message)) return "A department with this name already exists.";
  if (/designation_org_id_name_key/.test(message)) return "A designation with this name already exists.";
  if (/holiday_org_id_day_key/.test(message)) return "There is already a holiday on this date.";
  if (/leave_type_org_id_code_key/.test(message)) return "A leave type with this code already exists.";
  if (/row-level security|permission denied/.test(message)) return "You do not have permission to do this.";
  if (/violates check constraint|violates foreign key/.test(message)) return "Some details are not valid. Please check and try again.";
  return message.length < 160 ? message : "Something went wrong. Please try again.";
}
