"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";
import type { CertificateKind } from "@/core/certificates";

// Certificates are made by the office outside CampusTwin and uploaded as files
// (PDF), one at a time or many at once by admission number, or recorded from
// the old register. Only the office uploads and withdraws; the database
// enforces the same, and that a recorded certificate never changes.

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const KINDS: CertificateKind[] = ["transfer", "bonafide", "character"];
const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

async function office() {
  const session = await getSession();
  return session?.staffId && session.staffRole === "office" ? session : null;
}

// ---------------------------------------------------------------------------
// Certificates issued outside CampusTwin: uploaded files and imported registers
// ---------------------------------------------------------------------------
// PDF as the office prepares them; a photo or scan as JPG or PNG is accepted too.
const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export async function signCertificateUpload(studentId: number, contentType: string) {
  const session = await office();
  if (!session) return fail("Only the school office can upload certificates.");
  if (!FILE_TYPES.includes(contentType)) return fail("Upload a PDF, JPG or PNG file.");
  const { certificateFileKey, presignPut, tenantPrefixForSchool } = await import("@/lib/r2");
  const key = certificateFileKey(await tenantPrefixForSchool(session.schoolId), studentId, contentType);
  return { ok: true as const, key, uploadUrl: await presignPut(key) };
}

async function ownKey(schoolId: number, studentId: number, key: unknown) {
  if (typeof key !== "string" || !key) return null;
  const { tenantPrefixForSchool } = await import("@/lib/r2");
  const prefix = await tenantPrefixForSchool(schoolId);
  return key.startsWith(`${prefix}/students/${studentId}/certificates/`) && !key.includes("..") ? key : null;
}

export async function recordUploadedCertificate(studentId: number, input: { kind: string; number: string; issuedOn: string; key: string }) {
  const session = await office();
  if (!session) return fail("Only the school office can upload certificates.");
  if (!KINDS.includes(input?.kind as CertificateKind)) return fail("Choose what kind of certificate it is.");
  const number = txt(input.number, 40) || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issuedOn ?? "")) return fail("Enter the date it was issued.");
  const key = await ownKey(session.schoolId, studentId, input.key);
  if (!key) return fail("Upload the file first.");
  const db = await untyped();
  const { error } = await db.from("certificate").insert({ student_id: studentId, kind: input.kind, source: "uploaded", number, issued_on: input.issuedOn, file_key: key, content: {}, issued_by: session.staffId });
  if (error) return fail(error.code === "23505" ? "This certificate number is already used." : "The certificate could not be saved. Please try again.");
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true as const };
}

// Many files at once, each named by the student's admission number
// (GFP260001.pdf, or GFP260001 TC.pdf): which admission numbers are known.
export async function studentsByAdmissionNo(admissionNos: string[]) {
  if (!(await office())) return fail("Only the school office can upload certificates.");
  const wanted = [...new Set((admissionNos ?? []).map((a) => txt(a, 40)).filter(Boolean))].slice(0, 500);
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  const found: Record<string, { id: number; name: string }> = {};
  for (let i = 0; i < wanted.length; i += 300) {
    const { data } = await supabase.from("student").select("id, full_name, admission_no").in("admission_no", wanted.slice(i, i + 300));
    for (const s of data ?? []) found[s.admission_no.toUpperCase()] = { id: s.id, name: s.full_name };
  }
  return { ok: true as const, found };
}

export async function attachCertificateFile(certificateId: number, studentId: number, key: string) {
  const session = await office();
  if (!session) return fail("Only the school office can upload certificates.");
  const own = await ownKey(session.schoolId, studentId, key);
  if (!own) return fail("Upload the file first.");
  const db = await untyped();
  const { data, error } = await db.from("certificate").update({ file_key: own }).eq("id", certificateId).eq("student_id", studentId).is("file_key", null).select("id");
  if (error || !data?.length) return fail("The file could not be attached. Please try again.");
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true as const };
}

// Opens a certificate's file through a two-minute link, for the office and principal.
export async function certificateFileLink(certificateId: number) {
  const session = await getSession();
  if (!session?.isAdminScope) return fail("Only the office or the principal can open certificate files.");
  const db = await untyped();
  const { data } = await db.from("certificate").select("file_key").eq("id", certificateId).maybeSingle();
  const key = (data as { file_key: string | null } | null)?.file_key;
  if (!key) return fail("This certificate has no file.");
  const { presignGet } = await import("@/lib/r2");
  return { ok: true as const, url: await presignGet(key) };
}

export type RegisterRow = { line: number; admissionNo: string; kind: string; number: string; issuedOn: string; errors: string[] };

// The school's old certificate register, by admission number.
export async function importCertificateRegister(rows: RegisterRow[]) {
  const session = await office();
  if (!session) return fail("Only the school office can import certificates.");
  if (!Array.isArray(rows) || !rows.length) return fail("There are no rows to import.");
  if (rows.length > 3000) return fail("Please import at most 3000 certificates at a time.");
  if (rows.some((r) => r.errors?.length)) return fail("Some rows have problems. Please fix the file and import it again.");
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  const wanted = [...new Set(rows.map((r) => r.admissionNo.trim()))];
  const idByAdm = new Map<string, number>();
  for (let i = 0; i < wanted.length; i += 300) {
    const { data } = await supabase.from("student").select("id, admission_no").in("admission_no", wanted.slice(i, i + 300));
    for (const s of data ?? []) idByAdm.set(s.admission_no.toUpperCase(), s.id);
  }
  const db = await untyped();
  let added = 0; const skipped: string[] = []; const unknown: string[] = [];
  for (const r of rows) {
    const id = idByAdm.get(r.admissionNo.trim().toUpperCase());
    if (!id) { unknown.push(r.admissionNo); continue; }
    const { error } = await db.from("certificate").insert({ student_id: id, kind: r.kind, source: "imported", number: r.number.trim() || null, issued_on: r.issuedOn, content: {}, issued_by: session.staffId });
    if (error) skipped.push(`${r.number} (${error.code === "23505" ? "already recorded" : "could not be saved"})`);
    else added++;
  }
  return { ok: true as const, added, skipped, unknown };
}

// Withdraws a recorded certificate (uploaded by mistake, or replaced). It stays
// on file, marked cancelled with the reason, and checks as cancelled.
export async function cancelCertificate(certificateId: number, reason: string) {
  if (!(await office())) return fail("Only the school office can withdraw certificates.");
  const why = txt(reason, 300);
  if (!why) return fail("Enter why the certificate is withdrawn.");
  const db = await untyped();
  const { data, error } = await db.from("certificate").update({ status: "cancelled", cancel_reason: why }).eq("id", certificateId).eq("status", "issued").select("student_id");
  if (error || !data?.length) return fail("That could not be withdrawn. Please try again.");
  revalidatePath(`/dashboard/students/${(data[0] as { student_id: number }).student_id}`);
  return { ok: true as const };
}
