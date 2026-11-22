// Types, labels and small helpers shared by the admissions screens and the
// server code behind them. No server-only or session imports here, so the
// public application form can use it too.

export const STATUSES = ["new", "contacted", "visit_scheduled", "applied", "admitted", "not_interested"] as const;
export type EnquiryStatus = (typeof STATUSES)[number];

export const SOURCES = ["walk_in", "phone", "online", "referral", "other"] as const;
export type EnquirySource = (typeof SOURCES)[number];

export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New",
  contacted: "Contacted",
  visit_scheduled: "Visit scheduled",
  applied: "Applied",
  admitted: "Admitted",
  not_interested: "Not interested",
};

export const SOURCE_LABEL: Record<EnquirySource, string> = {
  walk_in: "Walk-in",
  phone: "Phone",
  online: "Online form",
  referral: "Referral",
  other: "Other",
};

// Statuses that no longer need a follow-up.
export const CLOSED_STATUSES: EnquiryStatus[] = ["admitted", "not_interested"];

export const isStatus = (v: unknown): v is EnquiryStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);
export const isSource = (v: unknown): v is EnquirySource => typeof v === "string" && (SOURCES as readonly string[]).includes(v);

export type ClassRef = { id: number; name: string };
export type StaffRef = { id: number; name: string };

// One enquiry as the screens show it.
export type Enquiry = {
  id: number;
  childName: string;
  dateOfBirth: string | null;
  classId: number;
  className: string;
  guardianName: string;
  phone: string;
  email: string | null;
  address: string | null;
  previousSchool: string | null;
  message: string | null;
  source: EnquirySource;
  status: EnquiryStatus;
  assignedTo: number | null;
  assignedName: string | null;
  nextFollowUp: string | null;
  createdAt: string;
};

export type Followup = {
  id: number;
  note: string;
  byName: string;
  nextFollowUp: string | null;
  createdAt: string;
};

export type SourceReportRow = { source: EnquirySource; total: number; admitted: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SCHOOL_TZ = "Asia/Kolkata";

// Today's date (YYYY-MM-DD) where the school is, whatever the server's clock zone.
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// "2026-02-26" or a full timestamp -> "26 Feb 2026".
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  let ymd = value;
  if (value.length > 10) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    ymd = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return "—";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

// A real calendar date in YYYY-MM-DD form.
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Spaces, dashes, dots and brackets are dropped; a leading + is kept.
// Returns null unless 8 to 15 digits remain.
export function cleanPhone(raw: string): string | null {
  const s = (raw ?? "").trim().replace(/[\s\-().]/g, "");
  return /^\+?\d{8,15}$/.test(s) ? s : null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LIMITS = { name: 80, email: 120, address: 300, school: 120, message: 500, note: 1000 } as const;
