"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession, getCurrentYear } from "@/lib/session";

type R = { ok: true; message?: string } | { ok: false; error: string };
const clean = (e: { message: string }) => (e.message.length < 160 && !e.message.includes("violates") ? e.message : "Could not save.");
const PATH = "/dashboard/lectures";
type Part = "theory" | "practical" | "tutorial" | null;

export async function markCourseLecture(input: { subjectId: number; date: string; period: number; absent: number[]; component?: Part; reason?: string }): Promise<R> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isInteger(input.period) || input.period < 1 || input.period > 12) return { ok: false, error: "Choose the date and period." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_course_lecture" as never, { p_subject: input.subjectId, p_date: input.date, p_period: input.period, p_absent: input.absent,
    p_component: input.component ?? null, p_reason: input.reason?.trim() || null } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: `Saved for ${Number(data ?? 0)} students; ${input.absent.length} absent.` };
}

export async function markLecture(input: { sectionId: number; subjectId: number; date: string; period: number; absent: number[]; component?: Part; batch?: string | null; reason?: string }): Promise<R> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isInteger(input.period) || input.period < 1 || input.period > 12) return { ok: false, error: "Choose the date and period." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_lecture" as never, { p_section: input.sectionId, p_subject: input.subjectId, p_date: input.date, p_period: input.period, p_absent: input.absent,
    p_component: input.component ?? null, p_batch: input.batch || null, p_reason: input.reason?.trim() || null } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: `Saved for ${Number(data ?? 0)} students; ${input.absent.length} absent.` };
}

// The student (or family): "I was present at this lecture".
export async function requestCorrection(input: { studentId: number; date: string; period: number | null; subjectId: number | null; reason: string }): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_attendance_correction" as never, { p_student: input.studentId, p_date: input.date, p_period: input.period, p_subject: input.subjectId, p_reason: input.reason } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: "Sent to the teacher. You will be told the decision." };
}
export async function decideCorrection(id: number, accept: boolean, note: string): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_attendance_correction" as never, { p_id: id, p_accept: accept, p_note: note || null } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: accept ? "Corrected to present; the student is told." : "Declined; the student is told." };
}

// Set-up (colleges): a subject's parts, a section's lab batches, and who takes which part or batch.
export async function setSubjectParts(subjectId: number, parts: string[]): Promise<R> {
  if (!parts.length) return { ok: false, error: "Choose at least one part." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_subject_components" as never, { p_subject: subjectId, p_components: parts } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}
export async function saveBatches(sectionId: number, batches: { label: string; students: number[] }[]): Promise<R> {
  if (batches.some((b) => !/^[A-Za-z0-9 -]{1,20}$/.test(b.label.trim()))) return { ok: false, error: "Batch names are short, like B1 or Lab A." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_section_batches" as never, { p_section: sectionId, p_batches: batches.map((b) => ({ label: b.label.trim(), students: b.students })) } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: `Batches saved (${Number(data ?? 0)} students placed).` };
}
export async function addPartAllotment(input: { staffId: number; sectionId: number; subjectId: number; component: string; batch: string }): Promise<R> {
  const s = await getSession();
  if (!s?.isAdminScope) return { ok: false, error: "Only the office can assign teachers." };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No current year." };
  if (!["theory", "practical", "tutorial"].includes(input.component)) return { ok: false, error: "Choose the part." };
  const supabase = await createClient();
  const { error } = await supabase.from("teacher_allotment").insert({ staff_id: input.staffId, section_id: input.sectionId, subject_id: input.subjectId, academic_year_id: year.id,
    is_class_teacher: false, component: input.component, batch: input.batch.trim() || null } as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "This teacher already has this part (and batch) here." : "Could not assign." };
  revalidatePath(PATH);
  return { ok: true, message: "Assigned." };
}
export async function removePartAllotment(id: number): Promise<R> {
  const s = await getSession();
  if (!s?.isAdminScope) return { ok: false, error: "Only the office can change this." };
  const supabase = await createClient();
  const { error } = await supabase.from("teacher_allotment").delete().eq("id", id).not("component", "is", null);
  if (error) return { ok: false, error: "Could not remove." };
  revalidatePath(PATH);
  return { ok: true, message: "Removed." };
}
