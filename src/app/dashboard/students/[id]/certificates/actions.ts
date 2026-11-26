"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";
import { getCertificateFacts } from "@/lib/data/certificate-facts";
import { pdfClean } from "@/lib/pdf";
import type { CertificateContent, CertificateKind } from "@/core/certificates";
import { bonafideCertificate, characterCertificate, tcChecks, transferCertificate, type LetterInputs, type TcInputs } from "@/editions/school/certificates";

// Issuing certificates. Only the office issues, prints duplicates and cancels;
// the database enforces the same (and one original TC per student, and that an
// issued certificate never changes).

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const KINDS: CertificateKind[] = ["transfer", "bonafide", "character"];
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

async function office() {
  const session = await getSession();
  return session?.staffId && session.staffRole === "office" ? session : null;
}

async function build(studentId: number, kind: CertificateKind, inputs: Record<string, string>) {
  const session = await getSession();
  if (!session) return fail("Please sign in again.");
  if (session.school.edition !== "school") return fail("Certificates for colleges and universities are coming with the college edition.");
  const f = await getCertificateFacts(studentId, session.schoolId);
  if (!f) return fail("That student could not be found.");
  const issuedOn = todayIST();
  let content: CertificateContent; let blockers: string[] = []; let warnings: string[] = [];
  if (kind === "transfer") {
    const x: TcInputs = {
      lastExam: txt(inputs.lastExam), failed: txt(inputs.failed, 40) || "No", promotion: txt(inputs.promotion), ncc: txt(inputs.ncc) || "No",
      games: txt(inputs.games), conduct: txt(inputs.conduct, 60) || "Good", applicationDate: /^\d{4}-\d{2}-\d{2}$/.test(inputs.applicationDate ?? "") ? inputs.applicationDate : issuedOn,
      reason: txt(inputs.reason) || f.student.exitRemark || "", remarks: txt(inputs.remarks, 300), progress: txt(inputs.progress, 60),
    };
    ({ blockers, warnings } = tcChecks(f));
    if (!x.reason) blockers.push("Enter the reason for leaving.");
    content = transferCertificate(f, x, issuedOn);
  } else {
    const x: LetterInputs = { purpose: txt(inputs.purpose), conduct: txt(inputs.conduct, 60), remarks: txt(inputs.remarks, 300) };
    if (kind === "bonafide" && f.student.status !== "active") blockers.push("A bonafide certificate is for a student still on the roll. Issue a character or transfer certificate instead.");
    content = kind === "bonafide" ? bonafideCertificate(f, x) : characterCertificate(f, x);
  }
  if (pdfClean(f.student.name) !== f.student.name) warnings.push("The student's name has letters the certificate cannot print. Correct the name in English letters first.");
  return { ok: true as const, content, blockers, warnings, issuedOn, schoolName: [f.school.name, f.school.place].filter(Boolean).join(", ") };
}

export async function previewCertificate(studentId: number, kind: string, inputs: Record<string, string>) {
  if (!(await office())) return fail("Only the school office can issue certificates.");
  if (!KINDS.includes(kind as CertificateKind)) return fail("Choose a certificate.");
  return build(studentId, kind as CertificateKind, inputs ?? {});
}

export async function issueCertificate(studentId: number, kind: string, inputs: Record<string, string>, confirmed: boolean) {
  const session = await office();
  if (!session) return fail("Only the school office can issue certificates.");
  if (!KINDS.includes(kind as CertificateKind)) return fail("Choose a certificate.");
  const b = await build(studentId, kind as CertificateKind, inputs ?? {});
  if (!b.ok) return b;
  if (b.blockers.length) return fail(b.blockers[0]);
  if (b.warnings.length && !confirmed) return fail("Please read the warnings and confirm.");
  const db = await untyped();
  const { data, error } = await db.from("certificate").insert({
    student_id: studentId, kind, format: kind === "transfer" ? (b.content.title === "Transfer Certificate" ? "cbse" : "state") : null,
    content: b.content, issued_by: session.staffId,
  }).select("id, number, verify_token, issued_at").single();
  if (error) return fail(error.code === "23505" ? "This student already has a transfer certificate. Print a duplicate of it instead." : "The certificate could not be issued. Please try again.");
  revalidatePath(`/dashboard/students/${studentId}`);
  const r = data as { id: number; number: string; verify_token: string; issued_at: string };
  return { ok: true as const, id: r.id, number: r.number, token: r.verify_token, issuedOn: b.issuedOn, content: b.content, schoolName: b.schoolName };
}

// A reprint of an issued certificate: same number and content, marked
// "Duplicate", counted.
export async function printDuplicate(certificateId: number) {
  if (!(await office())) return fail("Only the school office can print certificates.");
  const db = await untyped();
  const { data: cur } = await db.from("certificate").select("copies, status").eq("id", certificateId).maybeSingle();
  const c = cur as { copies: number; status: string } | null;
  if (!c) return fail("That certificate could not be found.");
  if (c.status !== "issued") return fail("A cancelled certificate cannot be printed again.");
  const { error } = await db.from("certificate").update({ copies: c.copies + 1 }).eq("id", certificateId);
  if (error) return fail("That could not be done. Please try again.");
  return { ok: true as const };
}

export async function cancelCertificate(certificateId: number, reason: string) {
  if (!(await office())) return fail("Only the school office can cancel certificates.");
  const why = txt(reason, 300);
  if (!why) return fail("Enter why the certificate is cancelled.");
  const db = await untyped();
  const { data, error } = await db.from("certificate").update({ status: "cancelled", cancel_reason: why }).eq("id", certificateId).eq("status", "issued").select("student_id");
  if (error || !data?.length) return fail("That could not be cancelled. Please try again.");
  revalidatePath(`/dashboard/students/${(data[0] as { student_id: number }).student_id}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Certificates issued outside CampusTwin: uploaded files and imported registers
// ---------------------------------------------------------------------------
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
  const number = txt(input.number, 40);
  if (!number) return fail("Enter the certificate number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issuedOn ?? "")) return fail("Enter the date it was issued.");
  const key = await ownKey(session.schoolId, studentId, input.key);
  if (!key) return fail("Upload the file first.");
  const db = await untyped();
  const { error } = await db.from("certificate").insert({ student_id: studentId, kind: input.kind, source: "uploaded", number, issued_on: input.issuedOn, file_key: key, content: {}, issued_by: session.staffId });
  if (error) return fail(error.code === "23505" ? "This student already has a transfer certificate, or this number is already used." : "The certificate could not be saved. Please try again.");
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true as const };
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
    const { error } = await db.from("certificate").insert({ student_id: id, kind: r.kind, source: "imported", number: r.number.trim(), issued_on: r.issuedOn, content: {}, issued_by: session.staffId });
    if (error) skipped.push(`${r.number} (${error.code === "23505" ? "already recorded" : "could not be saved"})`);
    else added++;
  }
  return { ok: true as const, added, skipped, unknown };
}
