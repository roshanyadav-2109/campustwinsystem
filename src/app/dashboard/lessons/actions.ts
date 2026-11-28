"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R = { ok: true; message: string; id?: number } | { ok: false; error: string };
const PATH = "/dashboard/lessons";
const clean = (e: { message: string; code?: string } | null, f: string) => (e && (e.code === "P0001" || (e.message.length < 160 && !/violates|function|relation|column/.test(e.message))) ? e.message : f);

export async function saveSyllabus(subjectId: number, classId: number | null, units: { title: string; topics: string[] }[]): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_syllabus" as never, { p_subject: subjectId, p_class: classId, p_units: units } as never);
  if (error) return { ok: false, error: clean(error, "Could not save the syllabus.") };
  revalidatePath(PATH);
  return { ok: true, message: `Syllabus saved (${Number(data ?? 0)} topics).` };
}

export async function logLesson(input: { sectionId: number | null; subjectId: number; date: string; period: number | null; topics: number[]; summary: string; links: { title: string; url: string }[] }): Promise<R> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Choose the date of the lesson." };
  const links = input.links.filter((l) => l.url.trim());
  if (links.some((l) => !/^https:\/\/\S+$/.test(l.url.trim()))) return { ok: false, error: "Links start with https://" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("log_lesson" as never, { p_section: input.sectionId, p_subject: input.subjectId, p_date: input.date, p_period: input.period,
    p_topics: input.topics, p_summary: input.summary, p_links: links.map((l) => ({ title: l.title.trim(), url: l.url.trim() })) } as never);
  if (error) return { ok: false, error: clean(error, "Could not save the lesson.") };
  revalidatePath(PATH);
  return { ok: true, message: "Lesson saved; students can see it.", id: Number(data) };
}

const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx" };
export async function signLessonUpload(lessonId: number, contentType: string, size: number): Promise<{ ok: true; key: string; uploadUrl: string } | { ok: false; error: string }> {
  const ext = TYPES[contentType];
  if (!ext) return { ok: false, error: "Upload a PDF, Word, PowerPoint, Excel, JPG or PNG file." };
  if (size > 25 * 1024 * 1024) return { ok: false, error: "The file is over 25 MB." };
  const supabase = await createClient();
  const { data: school } = await supabase.rpc("lesson_upload_ok" as never, { p_lesson: lessonId } as never);
  if (!school) return { ok: false, error: "Not allowed." };
  const { presignPrivatePut, tenantPrefixForSchool } = await import("@/lib/r2");
  const key = `${await tenantPrefixForSchool(Number(school))}/lessons/${lessonId}/${crypto.randomUUID()}.${ext}`;
  return { ok: true, key, uploadUrl: await presignPrivatePut(key) };
}
export async function addLessonFile(lessonId: number, title: string, key: string): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_lesson_file" as never, { p_lesson: lessonId, p_title: title, p_key: key } as never);
  if (error) return { ok: false, error: clean(error, "Could not add the file.") };
  revalidatePath(PATH);
  return { ok: true, message: "File added." };
}
export async function removeMaterial(id: number): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_lesson_material" as never, { p_id: id } as never);
  if (error) return { ok: false, error: clean(error, "Could not remove it.") };
  revalidatePath(PATH);
  return { ok: true, message: "Removed." };
}
export async function materialLink(id: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lesson_material_key" as never, { p_id: id } as never);
  if (error || !data) return { ok: false, error: "Not available." };
  const { presignGet } = await import("@/lib/r2");
  return { ok: true, url: await presignGet(String(data)) };
}
