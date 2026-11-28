"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { consolidatedData } from "@/app/dashboard/results/actions";

type R = { ok: true; message?: string } | { ok: false; error: string };
const clean = (e: { message?: string } | null, fallback: string) => (e?.message && !/[_(]|violates|function|relation/.test(e.message) ? e.message : fallback);

// The exam cell issues a transcript: the standing at this moment, with a QR check.
export async function issueTranscript(admissionNo: string) {
  const supabase = await createClient();
  const { data: st } = await supabase.from("student").select("id").eq("admission_no", admissionNo.trim()).maybeSingle();
  if (!st) return { ok: false as const, error: "No student with that admission number." };
  const { data: token, error } = await supabase.rpc("issue_transcript" as never, { p_student: st.id } as never);
  if (error) return { ok: false as const, error: clean(error, "Could not issue the transcript.") };
  const { data: t } = await supabase.from("transcript_issue" as never).select("serial").eq("verify_token", String(token)).maybeSingle();
  const d = await consolidatedData(st.id);
  revalidatePath("/dashboard/transcripts");
  return { ok: true as const, token: String(token), serial: (t as unknown as { serial: string | null } | null)?.serial ?? null, ...d };
}

// The issued record again (same serial and QR), for a lost or extra copy.
export async function reprintTranscript(id: number) {
  const supabase = await createClient();
  const { data } = await supabase.from("transcript_issue" as never).select("verify_token, serial, cgpa, credits, snapshot, student_id, revoked_at").eq("id", id).maybeSingle();
  const t = data as unknown as { verify_token: string; serial: string | null; cgpa: number | null; credits: number | null; snapshot: { rows?: unknown[] } | null; student_id: number; revoked_at: string | null } | null;
  if (!t) return { ok: false as const, error: "Not found." };
  if (t.revoked_at) return { ok: false as const, error: "This transcript was withdrawn." };
  const d = await consolidatedData(t.student_id);
  const rows = (t.snapshot?.rows ?? d.rows) as typeof d.rows;
  return { ok: true as const, token: t.verify_token, serial: t.serial, student: d.student, rows, standing: { cgpa: t.cgpa, credits_earned: Number(t.credits ?? 0), backlogs: d.standing?.backlogs ?? 0 }, percent: d.percent };
}

export async function revokeTranscript(id: number): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_transcript" as never, { p_id: id } as never);
  if (error) return { ok: false, error: clean(error, "Could not withdraw it.") };
  revalidatePath("/dashboard/transcripts");
  return { ok: true, message: "Withdrawn. The QR check now says it is not valid." };
}

// Internal (continuous assessment) marks of a section, as the affiliating university asks for them.
export async function internalMarks(semesterId: number, sectionId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("compute_course_results" as never, { p_semester: semesterId, p_section: sectionId } as never);
  if (error) return { ok: false as const, error: clean(error, "Could not read the marks.") };
  const rows = (data ?? []) as unknown as { student_id: number; student_name: string; roll_no: number | null; course_code: string; course_name: string; cia: number | null; cia_max: number | null }[];
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const { data: st } = ids.length ? await supabase.from("student").select("id, admission_no").in("id", ids) : { data: [] };
  const adm = new Map(((st ?? []) as { id: number; admission_no: string }[]).map((s) => [s.id, s.admission_no]));
  return { ok: true as const, rows: rows.map((r) => ({ ...r, admission_no: adm.get(r.student_id) ?? "" })) };
}

export type ImportRow = { admission_no: string | null; register_no: string | null; course_code: string; grade: string; point: number | null; passed: boolean | null };

export async function setRegisterNumbers(rows: { admission_no: string; register_no: string }[]): Promise<R> {
  if (!rows.length) return { ok: false, error: "The file has no rows." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_register_numbers" as never, { p_rows: rows } as never);
  if (error) return { ok: false, error: clean(error, "Could not save the register numbers.") };
  return { ok: true, message: `Register numbers saved for ${Number(data ?? 0)} students.` };
}
export async function importUniversityResults(semesterId: number, rows: ImportRow[], kind: "regular" | "supplementary" = "regular"): Promise<R> {
  if (!rows.length) return { ok: false, error: "The file has no rows." };
  if (rows.length > 5000) return { ok: false, error: "Import at most 5,000 rows at a time." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_university_results" as never, { p_semester: semesterId, p_rows: rows, p_kind: kind } as never);
  if (error) return { ok: false, error: clean(error, "Could not import.") };
  revalidatePath("/dashboard/results");
  return { ok: true, message: `Imported ${Number(data ?? 0)} course results. Students see them on their Results page.` };
}
