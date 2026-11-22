import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getReference } from "@/lib/data/reference";
import { isMissingTable, untyped } from "@/lib/data/schedule";
import {
  CLOSED_STATUSES, SOURCES, STATUSES, isSource, isStatus, todayIso,
  type ClassRef, type Enquiry, type EnquirySource, type EnquiryStatus, type Followup, type SourceReportRow, type StaffRef,
} from "@/components/admissions/shared";

// Admissions data (migration 0042). The generated database types do not know
// these tables yet, so queries go through the untyped client and results are
// cast to the row types below. Row security lets only the principal and the
// office read them.

type EnquiryDb = {
  id: number;
  child_name: string;
  date_of_birth: string | null;
  class_id: number;
  guardian_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  previous_school: string | null;
  message: string | null;
  source: string;
  status: string;
  assigned_to: number | null;
  next_follow_up: string | null;
  created_at: string;
};

const ENQUIRY_COLS =
  "id, child_name, date_of_birth, class_id, guardian_name, phone, email, address, previous_school, message, source, status, assigned_to, next_follow_up, created_at";

const PAGE = 1000;
const MAX_ROWS = 5000;

// Classes a child can apply to, lowest first. From the shared reference copy.
export async function getClassList(): Promise<ClassRef[]> {
  const ref = await getReference();
  const byId = new Map<number, { id: number; name: string; level: number }>();
  for (const s of ref.sections) if (s.class) byId.set(s.class.id, s.class);
  return [...byId.values()].sort((a, b) => a.level - b.level).map((c) => ({ id: c.id, name: c.name }));
}

// Office and principal staff: the people an enquiry can be assigned to.
export async function getAdmissionStaff(): Promise<StaffRef[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("staff").select("id, full_name, role").in("role", ["office", "principal"]).order("full_name");
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name }));
}

// Every enquiry for a school year, newest first. `missing` = the tables are not there yet.
export async function getEnquiries(
  yearId: number,
  classes: ClassRef[],
  staff: StaffRef[],
): Promise<{ missing: true } | { missing: false; rows: Enquiry[] }> {
  const db = await untyped();
  const all: EnquiryDb[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db
      .from("admission_enquiry")
      .select(ENQUIRY_COLS)
      .eq("academic_year_id", yearId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return { missing: true };
      throw new Error("Could not load admission enquiries.");
    }
    const batch = (data ?? []) as EnquiryDb[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }

  const className = new Map(classes.map((c) => [c.id, c.name]));
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const rows: Enquiry[] = all.map((r) => ({
    id: r.id,
    childName: r.child_name,
    dateOfBirth: r.date_of_birth,
    classId: r.class_id,
    className: className.get(r.class_id) ?? "—",
    guardianName: r.guardian_name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    previousSchool: r.previous_school,
    message: r.message,
    source: (isSource(r.source) ? r.source : "other") as EnquirySource,
    status: (isStatus(r.status) ? r.status : "new") as EnquiryStatus,
    assignedTo: r.assigned_to,
    assignedName: r.assigned_to != null ? staffName.get(r.assigned_to) ?? null : null,
    nextFollowUp: r.next_follow_up,
    createdAt: r.created_at,
  }));
  return { missing: false, rows };
}

// Follow-up notes on one enquiry, newest first.
export async function getFollowups(enquiryId: number): Promise<Followup[]> {
  const db = await untyped();
  const { data, error } = await db
    .from("admission_followup")
    .select("id, note, by_staff, next_follow_up, created_at")
    .eq("enquiry_id", enquiryId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) return [];
  const rows = (data ?? []) as { id: number; note: string; by_staff: number; next_follow_up: string | null; created_at: string }[];
  const ids = [...new Set(rows.map((r) => r.by_staff))];
  const names = new Map<number, string>();
  if (ids.length) {
    const supabase = await createClient();
    const { data: st } = await supabase.from("staff").select("id, full_name").in("id", ids);
    for (const s of st ?? []) names.set(s.id, s.full_name);
  }
  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    byName: names.get(r.by_staff) ?? "Office",
    nextFollowUp: r.next_follow_up,
    createdAt: r.created_at,
  }));
}

export type EnquiryFilter = { status: EnquiryStatus | null; classId: number | null; source: EnquirySource | null; q: string };

export function filterEnquiries(rows: Enquiry[], f: EnquiryFilter): Enquiry[] {
  const q = f.q.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return rows.filter((r) => {
    if (f.status && r.status !== f.status) return false;
    if (f.classId && r.classId !== f.classId) return false;
    if (f.source && r.source !== f.source) return false;
    if (!q) return true;
    if (r.childName.toLowerCase().includes(q) || r.guardianName.toLowerCase().includes(q)) return true;
    return qDigits.length >= 3 && r.phone.replace(/\D/g, "").includes(qDigits);
  });
}

export function statusCounts(rows: Enquiry[]): Record<EnquiryStatus, number> {
  const out = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<EnquiryStatus, number>;
  for (const r of rows) out[r.status] += 1;
  return out;
}

// Open enquiries whose follow-up date is today or already past, oldest date first.
export function followUpsDue(rows: Enquiry[]): Enquiry[] {
  const today = todayIso();
  return rows
    .filter((r) => r.nextFollowUp != null && r.nextFollowUp <= today && !CLOSED_STATUSES.includes(r.status))
    .sort((a, b) => (a.nextFollowUp! < b.nextFollowUp! ? -1 : a.nextFollowUp! > b.nextFollowUp! ? 1 : 0));
}

export function sourceReport(rows: Enquiry[]): SourceReportRow[] {
  return SOURCES.map((source) => {
    const mine = rows.filter((r) => r.source === source);
    return { source, total: mine.length, admitted: mine.filter((r) => r.status === "admitted").length };
  });
}
