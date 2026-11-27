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
  const d = await consolidatedData(st.id);
  if (!d.rows.length) return { ok: false as const, error: "This student has no published results yet." };
  revalidatePath("/dashboard/transcripts");
  return { ok: true as const, token: String(token), ...d };
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

export type ImportRow = { admission_no: string; course_code: string; grade: string; point: number | null; passed: boolean | null };
export async function importUniversityResults(semesterId: number, rows: ImportRow[]): Promise<R> {
  if (!rows.length) return { ok: false, error: "The file has no rows." };
  if (rows.length > 5000) return { ok: false, error: "Import at most 5,000 rows at a time." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_university_results" as never, { p_semester: semesterId, p_rows: rows } as never);
  if (error) return { ok: false, error: clean(error, "Could not import.") };
  revalidatePath("/dashboard/results");
  return { ok: true, message: `Imported ${Number(data ?? 0)} course results. Students see them on their Results page.` };
}
