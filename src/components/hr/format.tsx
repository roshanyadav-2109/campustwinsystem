// Small formatters shared by the Staff HR page (server) and its client parts.
// No server-only imports here, so both sides can use it.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-02-26" (or a timestamp starting that way) -> "26 Feb 2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return "-";
  const m = Number(iso.slice(5, 7));
  return `${Number(iso.slice(8, 10))} ${MONTHS[m - 1] ?? ""} ${iso.slice(0, 4)}`;
}

/** "26 Feb 2026" for one day, "26 Feb 2026 to 2 Mar 2026" for a range. */
export function fmtRange(from: string, to: string): string {
  return from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;
}

/** "2026-03-01" or "2026-03" -> "March 2026". */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${MONTHS_LONG[m - 1] ?? ""} ${month.slice(0, 4)}`;
}

/** 12500 -> "₹ 12,500"; 12500.5 -> "₹ 12,500.50". */
export function fmtMoney(n: number): string {
  const whole = Number.isInteger(n);
  return `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Plain figure for PDFs, whose built-in fonts have no rupee sign. */
export function fmtAmount(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 1 -> "1 day", 0.5 -> "Half day", 2.5 -> "2.5 days". */
export function fmtDays(n: number): string {
  if (n === 0.5) return "Half day";
  return `${n} ${n === 1 ? "day" : "days"}`;
}

const ROLE_LABEL: Record<string, string> = {
  principal: "Principal",
  office: "Office",
  class_teacher: "Class teacher",
  subject_teacher: "Teacher",
};
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "Staff";
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export const LEAVE_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
