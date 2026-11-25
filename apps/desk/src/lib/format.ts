// Labels, India time, and plain-language durations for the help desk.
const IST = "Asia/Kolkata";

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function fyOf(day: string): { label: string; start: string; end: string } {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const s = m >= 4 ? y : y - 1;
  return { label: `${s}-${String((s + 1) % 100).padStart(2, "0")}`, start: `${s}-04-01`, end: `${s + 1}-03-31` };
}

export function fmtWhen(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
}

export function fmtDate(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
}

// "3 h", "2 days", for durations given in hours.
export function hoursText(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

// How a deadline stands right now: overdue by, or due in.
export function dueText(by: string | null, done: boolean): { text: string; late: boolean } | null {
  if (!by || done) return null;
  const diff = (new Date(by).getTime() - Date.now()) / 3600e3;
  return diff < 0 ? { text: `overdue by ${hoursText(-diff)}`, late: true } : { text: `due in ${hoursText(diff)}`, late: false };
}

export const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", waiting: "Waiting for requester", resolved: "Resolved", closed: "Closed",
};
export const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "off"> = {
  open: "warn", in_progress: "warn", waiting: "off", resolved: "ok", closed: "off",
};
export const PRIORITY_LABEL: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
export const KIND_LABEL: Record<string, string> = { request: "Request", complaint: "Complaint", grievance: "Grievance" };
export const DONE = ["resolved", "closed"];

export function friendly(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Please try again.";
  if (/category_org_id_name_key/.test(message)) return "A category with this name already exists.";
  if (/row-level security|permission denied/.test(message)) return "You do not have permission to do this.";
  if (/violates check constraint/.test(message)) return "Some details are not valid. Please check and try again.";
  return message.length < 200 ? message : "Something went wrong. Please try again.";
}
