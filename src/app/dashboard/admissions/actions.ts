"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession, getCurrentYear } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";
import { saveStudent } from "@/app/dashboard/students/manage/actions";
import { EMAIL_RE, LIMITS, cleanPhone, isIsoDate, isSource, isStatus, todayIso } from "@/components/admissions/shared";

export type Result = { ok: true } | { ok: false; error: string };

const TAB = "/dashboard/admissions";
const OFFICE_ONLY = "Only the school office can change admission enquiries.";
const FAILED = "This could not be saved. Please try again.";

const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
const multiline = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

// Only the office enters and updates enquiries; the principal reads.
async function officeSession() {
  const session = await getSession();
  if (!session?.staffId || session.staffRole !== "office") return null;
  return session;
}

// An optional date field: "" -> null, otherwise it must be a real date.
function optDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  const s = text(v);
  if (!s) return { ok: true, value: null };
  return isIsoDate(s) ? { ok: true, value: s } : { ok: false };
}

// Is this staff member someone an enquiry can be assigned to (office or principal)?
async function assignable(staffId: number): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("staff").select("id, role").eq("id", staffId).maybeSingle();
  return !!data && (data.role === "office" || data.role === "principal");
}

export type EnquiryInput = {
  childName: string;
  dateOfBirth: string;
  classId: number | null;
  guardianName: string;
  phone: string;
  email: string;
  address: string;
  previousSchool: string;
  message: string;
  source: string;
  assignedTo: number | null;
  nextFollowUp: string;
};

export async function createEnquiry(input: EnquiryInput): Promise<Result> {
  const session = await officeSession();
  if (!session) return { ok: false, error: OFFICE_ONLY };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No school year is set up yet." };

  const childName = text(input?.childName);
  const guardianName = text(input?.guardianName);
  const email = text(input?.email).toLowerCase();
  const address = text(input?.address);
  const previousSchool = text(input?.previousSchool);
  const message = multiline(input?.message);
  const classId = posInt(input?.classId);
  const assignedTo = input?.assignedTo == null ? null : posInt(input.assignedTo);

  if (!childName) return { ok: false, error: "Enter the child's name." };
  if (childName.length > LIMITS.name) return { ok: false, error: `The child's name can be at most ${LIMITS.name} characters.` };
  if (!classId) return { ok: false, error: "Choose the class sought." };
  if (!guardianName) return { ok: false, error: "Enter the parent or guardian's name." };
  if (guardianName.length > LIMITS.name) return { ok: false, error: `The parent's name can be at most ${LIMITS.name} characters.` };
  const phone = cleanPhone(typeof input?.phone === "string" ? input.phone : "");
  if (!phone) return { ok: false, error: "Enter a phone number with 8 to 15 digits." };
  if (email && (email.length > LIMITS.email || !EMAIL_RE.test(email))) return { ok: false, error: "Enter a valid email address, or leave it empty." };
  if (address.length > LIMITS.address) return { ok: false, error: `The address can be at most ${LIMITS.address} characters.` };
  if (previousSchool.length > LIMITS.school) return { ok: false, error: `The previous school can be at most ${LIMITS.school} characters.` };
  if (message.length > LIMITS.message) return { ok: false, error: `The note can be at most ${LIMITS.message} characters.` };
  if (!isSource(input?.source)) return { ok: false, error: "Choose how the enquiry came in." };

  const dob = optDate(input?.dateOfBirth);
  if (!dob.ok || (dob.value && dob.value > todayIso())) return { ok: false, error: "Enter a valid date of birth." };
  const followUp = optDate(input?.nextFollowUp);
  if (!followUp.ok) return { ok: false, error: "Enter a valid follow-up date." };
  if (input?.assignedTo != null && !assignedTo) return { ok: false, error: "Choose a staff member from the list." };

  const supabase = await createClient();
  const { data: cls } = await supabase.from("class").select("id").eq("id", classId).maybeSingle();
  if (!cls) return { ok: false, error: "Choose a class from the list." };
  if (assignedTo && !(await assignable(assignedTo))) return { ok: false, error: "Choose a staff member from the list." };

  const db = await untyped();
  const { error } = await db.from("admission_enquiry").insert({
    child_name: childName,
    date_of_birth: dob.value,
    class_id: classId,
    guardian_name: guardianName,
    phone,
    email: email || null,
    address: address || null,
    previous_school: previousSchool || null,
    message: message || null,
    source: input.source,
    status: "new",
    assigned_to: assignedTo,
    next_follow_up: followUp.value,
    academic_year_id: year.id,
    created_by: session.staffId,
  });
  if (error) return { ok: false, error: FAILED };
  revalidatePath(TAB);
  return { ok: true };
}

// Status, who looks after it, and the next follow-up date.
export async function updateEnquiry(
  id: number,
  input: { status: string; assignedTo: number | null; nextFollowUp: string },
): Promise<Result> {
  const session = await officeSession();
  if (!session) return { ok: false, error: OFFICE_ONLY };
  const enquiryId = posInt(id);
  if (!enquiryId) return { ok: false, error: "That enquiry was not found." };
  if (!isStatus(input?.status)) return { ok: false, error: "Choose a status from the list." };
  const assignedTo = input?.assignedTo == null ? null : posInt(input.assignedTo);
  if (input?.assignedTo != null && !assignedTo) return { ok: false, error: "Choose a staff member from the list." };
  const followUp = optDate(input?.nextFollowUp);
  if (!followUp.ok) return { ok: false, error: "Enter a valid follow-up date." };
  if (assignedTo && !(await assignable(assignedTo))) return { ok: false, error: "Choose a staff member from the list." };

  const db = await untyped();
  const { data, error } = await db
    .from("admission_enquiry")
    .update({ status: input.status, assigned_to: assignedTo, next_follow_up: followUp.value })
    .eq("id", enquiryId)
    .select("id");
  if (error) return { ok: false, error: FAILED };
  if (!data?.length) return { ok: false, error: "That enquiry was not found." };
  revalidatePath(TAB);
  return { ok: true };
}

// A note on a call or visit. A next follow-up date given here also becomes the
// enquiry's follow-up date.
export async function addFollowup(id: number, input: { note: string; nextFollowUp: string }): Promise<Result> {
  const session = await officeSession();
  if (!session?.staffId) return { ok: false, error: OFFICE_ONLY };
  const enquiryId = posInt(id);
  if (!enquiryId) return { ok: false, error: "That enquiry was not found." };
  const note = multiline(input?.note);
  if (!note) return { ok: false, error: "Write a short note first." };
  if (note.length > LIMITS.note) return { ok: false, error: `The note can be at most ${LIMITS.note} characters.` };
  const followUp = optDate(input?.nextFollowUp);
  if (!followUp.ok) return { ok: false, error: "Enter a valid follow-up date." };

  const db = await untyped();
  const { data: enquiry } = await db.from("admission_enquiry").select("id").eq("id", enquiryId).maybeSingle();
  if (!enquiry) return { ok: false, error: "That enquiry was not found." };

  const { error } = await db.from("admission_followup").insert({
    enquiry_id: enquiryId,
    note,
    by_staff: session.staffId,
    next_follow_up: followUp.value,
  });
  if (error) return { ok: false, error: FAILED };

  if (followUp.value) {
    const { error: upErr } = await db.from("admission_enquiry").update({ next_follow_up: followUp.value }).eq("id", enquiryId);
    if (upErr) {
      revalidatePath(TAB);
      return { ok: false, error: "The note was saved, but the follow-up date could not be updated. Set it under Status and follow-up." };
    }
  }
  revalidatePath(TAB);
  return { ok: true };
}

// --- Admit: turn an enquiry into a student -----------------------------------

export type AdmitOptions =
  | { ok: true; sections: { id: number; name: string }[]; suggestedAdmissionNo: string }
  | { ok: false; error: string };

// The next admission number in the school's own pattern: the most common
// "letters + digits" shape, with the highest number + 1 and the same width.
function nextAdmissionNo(existing: string[]): string {
  const shapes = new Map<string, { count: number; max: number; width: number }>();
  for (const a of existing) {
    const m = a.trim().match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const key = `${m[1]}|${m[2].length}`;
    const cur = shapes.get(key) ?? { count: 0, max: 0, width: m[2].length };
    cur.count += 1;
    cur.max = Math.max(cur.max, Number(m[2]));
    shapes.set(key, cur);
  }
  if (!shapes.size) return "";
  const [key, best] = [...shapes.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const prefix = key.split("|")[0];
  return prefix + String(best.max + 1).padStart(best.width, "0");
}

export async function getAdmitOptions(enquiryId: number): Promise<AdmitOptions> {
  const session = await officeSession();
  if (!session) return { ok: false, error: OFFICE_ONLY };
  const id = posInt(enquiryId);
  if (!id) return { ok: false, error: "That enquiry was not found." };
  const db = await untyped();
  const { data: enq } = await db.from("admission_enquiry").select("class_id").eq("id", id).maybeSingle();
  if (!enq) return { ok: false, error: "That enquiry was not found." };
  const supabase = await createClient();
  const [{ data: sections }, { data: nos }] = await Promise.all([
    supabase.from("section").select("id, name").eq("class_id", enq.class_id).order("name"),
    supabase.from("student").select("admission_no").order("id", { ascending: false }).limit(5000),
  ]);
  return {
    ok: true,
    sections: (sections ?? []).map((s) => ({ id: s.id, name: s.name })),
    suggestedAdmissionNo: nextAdmissionNo((nos ?? []).map((n) => n.admission_no ?? "").filter(Boolean)),
  };
}

// Creates the student, their parent (so the parent can sign in with Google on
// the email given) and this year's class place, then marks the enquiry admitted
// and links it to the new record. Runs once per enquiry.
export async function admitEnquiry(
  enquiryId: number,
  input: { sectionId: number; admissionNo: string; rollNo: string },
): Promise<Result> {
  const session = await officeSession();
  if (!session) return { ok: false, error: OFFICE_ONLY };
  const id = posInt(enquiryId);
  if (!id) return { ok: false, error: "That enquiry was not found." };
  const db = await untyped();
  const { data: enq } = await db
    .from("admission_enquiry")
    .select("id, student_id, child_name, date_of_birth, class_id, guardian_name, phone, email, address, previous_school, class(name)")
    .eq("id", id).maybeSingle();
  if (!enq) return { ok: false, error: "That enquiry was not found." };
  if (enq.student_id) return { ok: false, error: "This child has already been admitted." };

  const supabase = await createClient();
  const { data: sec } = await supabase.from("section").select("id, class_id").eq("id", input.sectionId).maybeSingle();
  if (!sec || sec.class_id !== enq.class_id) return { ok: false, error: "Choose a section of the class the child is joining." };

  const admissionNo = text(input.admissionNo);
  const res = await saveStudent({
    fullName: enq.child_name,
    admissionNo,
    dob: enq.date_of_birth ?? "",
    gender: "",
    sectionId: sec.id,
    rollNo: text(input.rollNo),
    studentEmail: "",
    studentPhone: "",
    guardian: { id: null, fullName: enq.guardian_name ?? "", relation: "", phone: enq.phone ?? "", email: enq.email ?? "" },
  });
  // Link the enquiry whenever the student record exists, even if the parent
  // part failed, so the child is never admitted twice.
  const { data: student } = await supabase.from("student").select("id").eq("admission_no", admissionNo).maybeSingle();
  if (student) {
    await db.from("admission_enquiry").update({ status: "admitted", student_id: student.id }).eq("id", id);
    // Start the student's profile from what the family gave in the enquiry.
    const e = enq as unknown as { address: string | null; previous_school: string | null; class: { name: string } | null };
    await db.from("student_profile").upsert({
      student_id: student.id,
      admission_date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10),
      admitted_class: e.class?.name ?? null,
      previous_school: e.previous_school?.trim().slice(0, 160) || null,
      address_line: e.address?.trim().slice(0, 240) || null,
    }, { onConflict: "student_id", ignoreDuplicates: true });
    revalidatePath(TAB);
  }
  return res;
}
