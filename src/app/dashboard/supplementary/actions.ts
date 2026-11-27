"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { isExams } from "@/lib/roles";

type R = { ok: true; message?: string; id?: number } | { ok: false; error: string };
const PATH = "/dashboard/supplementary";
const clean = (e: { message: string }, f: string) => (e.message.length < 160 && !e.message.includes("violates") ? e.message : f);

export async function createSupplementary(input: { semesterId: number; name: string; fee: string; closes: string }): Promise<R> {
  const s = await getSession();
  if (!isExams(s)) return { ok: false, error: "Only the exam cell can set up supplementary exams." };
  const name = input.name.trim();
  if (name.length < 3 || name.length > 80) return { ok: false, error: "Give the exam a name." };
  if (input.fee.trim() && !/^\d{1,6}(\.\d{1,2})?$/.test(input.fee.trim())) return { ok: false, error: "The fee per course is an amount in rupees." };
  if (input.closes && !/^\d{4}-\d{2}-\d{2}$/.test(input.closes)) return { ok: false, error: "Check the closing date." };
  const supabase = await createClient();
  const { data: sem } = await supabase.from("semester" as never).select("academic_year_id, kind").eq("id", input.semesterId).maybeSingle();
  const semRow = sem as unknown as { academic_year_id: number; kind: string } | null;
  if (!semRow) return { ok: false, error: "Choose the semester." };
  const { data: t } = await supabase.from("assessment_type").select("id").eq("code", "annual").maybeSingle();
  if (!t) return { ok: false, error: "The end-semester exam type is missing (Settings, Exams)." };
  const { data, error } = await supabase.from("exam_session" as never).insert({
    academic_year_id: semRow.academic_year_id, name, term: semRow.kind === "even" ? 2 : 1, assessment_type_id: t.id, kind: "supplementary",
    for_semester_id: input.semesterId, fee_per_course: input.fee.trim() ? Number(input.fee) : null, registration_closes: input.closes || null,
  } as never).select("id").single();
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "An exam with this name already exists this year." : clean(error, "Could not create it.") };
  revalidatePath(PATH);
  return { ok: true, id: (data as unknown as { id: number }).id, message: "Created. Register the backlogs next." };
}

export async function registerBacklogs(sessionId: number): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_backlogs" as never, { p_session: sessionId, p_student: null } as never);
  if (error) return { ok: false, error: clean(error, "Could not register.") };
  revalidatePath(PATH);
  const n = Number(data ?? 0);
  return { ok: true, message: n ? `${n} backlog courses registered.` : "No new backlogs to register." };
}

export async function saveSuppMarks(rows: { id: number; marks: string; absent: boolean }[]): Promise<R> {
  for (const r of rows) if (!r.absent && r.marks.trim() && !/^\d{1,3}(\.\d{1,2})?$/.test(r.marks.trim())) return { ok: false, error: "Marks are numbers." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_supp_marks" as never, {
    p_ids: rows.map((r) => r.id), p_marks: rows.map((r) => (r.absent || !r.marks.trim() ? null : Number(r.marks))), p_absent: rows.map((r) => r.absent),
  } as never);
  if (error) return { ok: false, error: clean(error, "Could not save the marks.") };
  revalidatePath(PATH);
  return { ok: true, message: `Saved ${Number(data ?? 0)}.` };
}

export async function publishSupplementary(sessionId: number): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_supplementary" as never, { p_session: sessionId } as never);
  if (error) return { ok: false, error: clean(error, "Could not publish.") };
  revalidatePath(PATH); revalidatePath("/dashboard/results");
  const n = Number(data ?? 0);
  return { ok: true, message: n ? `Published ${n} results.` : "Nothing to publish: enter marks (or mark absent) first." };
}
