"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentYear, getSession } from "@/lib/session";
import { isExams } from "@/lib/roles";

// Exam timetable and admit cards. The office writes; the database checks
// clashes, institution and who may print which admit card.
export type Result = { ok: true; message?: string; id?: number } | { ok: false; error: string };
const PATH = "/dashboard/exam-timetable";
async function office() { const s = await getSession(); return isExams(s) ? s : null; }
const err = (e: { message: string } | null, f: string) => (e && e.message.length < 160 && !e.message.includes("violates") ? e.message : f);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveSession(input: { id?: number | null; name: string; term: number; typeId: number; instructions: string; withhold: boolean }): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can set exams." };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No current year is set." };
  if (!input.name.trim() || input.name.trim().length > 80) return { ok: false, error: "Give the exam a name." };
  if (!Number.isInteger(input.term) || input.term < 1 || input.term > 6 || !input.typeId) return { ok: false, error: "Choose the term and the exam type." };
  const row = { academic_year_id: year.id, name: input.name.trim(), term: input.term, assessment_type_id: input.typeId,
    instructions: input.instructions.trim().slice(0, 1500) || null, withhold_fee_dues: !!input.withhold };
  const supabase = await createClient();
  const q = input.id
    ? supabase.from("exam_session" as never).update(row as never).eq("id", input.id).select("id").single()
    : supabase.from("exam_session" as never).insert(row as never).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "An exam with this name already exists this year." : err(error, "Could not save the exam.") };
  revalidatePath(PATH);
  return { ok: true, id: (data as unknown as { id: number }).id, message: "Saved." };
}

export async function publishSession(id: number, publish: boolean): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can publish exams." };
  const supabase = await createClient();
  const { error } = await supabase.from("exam_session" as never).update({ published_at: publish ? new Date().toISOString() : null } as never).eq("id", id);
  if (error) return { ok: false, error: "Could not change it." };
  revalidatePath(PATH);
  return { ok: true, message: publish ? "Published. Parents and students can see the date sheet and download admit cards." : "Hidden from parents and students." };
}

export async function deleteSession(id: number): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can remove exams." };
  const supabase = await createClient();
  const { error } = await supabase.from("exam_session" as never).delete().eq("id", id);
  if (error) return { ok: false, error: err(error, "Could not remove the exam: marks may already be entered for it.") };
  revalidatePath(PATH);
  return { ok: true, message: "Removed." };
}

export async function savePaper(input: { id?: number | null; sessionId: number; classId: number; subjectId: number; date: string; start: string; end: string; max: string; note: string; component: string; group: string }): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can set exams." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !TIME.test(input.start) || !TIME.test(input.end)) return { ok: false, error: "Give the date and the start and end times." };
  if (input.end <= input.start) return { ok: false, error: "The paper must end after it starts." };
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(input.max) || Number(input.max) <= 0) return { ok: false, error: "Give the maximum marks." };
  const component = input.component.trim().slice(0, 30) || "Theory";
  const changes = { exam_date: input.date, starts_at: input.start, ends_at: input.end, max_marks: Number(input.max), note: input.note.trim().slice(0, 120) || null,
    component, optional_group: input.group.trim().slice(0, 30) || null };
  const supabase = await createClient();
  const { error } = input.id
    ? await supabase.from("exam_paper" as never).update(changes as never).eq("id", input.id)
    : await supabase.from("exam_paper" as never).insert({ ...changes, session_id: input.sessionId, class_id: input.classId, subject_id: input.subjectId } as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "This subject already has this paper (theory, practical...) in this exam for the class." : err(error, "Could not save the paper.") };
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

export async function deletePaper(id: number): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can set exams." };
  const supabase = await createClient();
  const { error } = await supabase.from("exam_paper" as never).delete().eq("id", id);
  if (error) return { ok: false, error: err(error, "Could not remove the paper.") };
  revalidatePath(PATH);
  return { ok: true, message: "Removed." };
}

export type AdmitRow = { student_id: number; student_name: string; admission_no: string; roll_no: number | null; class_label: string; withheld: boolean; reason: string | null; verify_token: string; subject_ids: number[] | null };

// Admit cards for a section (office, class teacher) or one student (their family).
export async function admitCards(sessionId: number, sectionId: number, studentId?: number): Promise<{ ok: true; rows: AdmitRow[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prepare_admit_cards" as never, { p_session: sessionId, p_section: sectionId, p_student: studentId ?? null } as never);
  if (error) return { ok: false, error: err(error, "Could not prepare admit cards.") };
  return { ok: true, rows: (data ?? []) as unknown as AdmitRow[] };
}
