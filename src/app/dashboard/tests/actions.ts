"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R<T = undefined> = ({ ok: true; message?: string } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };
const clean = (e: { message: string; code?: string } | null, f: string) => (e && (e.code === "P0001" || (e.message.length < 160 && !/violates|function|relation|column/.test(e.message))) ? e.message : f);
const PATH = "/dashboard/tests";

export type QuestionIn = { kind: "single" | "multi" | "truefalse" | "number" | "short"; prompt: string; options: string[]; answer: unknown; marks: number; negative: number };
export type TestIn = { subject_id: number; section_ids: number[]; title: string; instructions: string; opens_at: string; closes_at: string; minutes: number; attempts: number; shuffle: boolean; show_answers: string; questions: QuestionIn[] };

export async function saveTest(id: number | null, t: TestIn): Promise<R<number>> {
  if (!t.title.trim()) return { ok: false, error: "Give the test a title." };
  if (!t.section_ids.length) return { ok: false, error: "Choose at least one section." };
  if (!(t.minutes >= 1 && t.minutes <= 600)) return { ok: false, error: "The time limit is 1 to 600 minutes." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_test" as never, { p_id: id, p: t } as never);
  if (error) return { ok: false, error: clean(error, "Could not save the test.") };
  revalidatePath(PATH);
  return { ok: true, message: "Test saved.", data: Number(data) };
}
export async function publishTest(id: number, publish: boolean): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_test" as never, { p_id: id, p_publish: publish } as never);
  if (error) return { ok: false, error: clean(error, "Could not change it.") };
  revalidatePath(PATH);
  return { ok: true, message: publish ? "Published: students can see it." : "Hidden from students." };
}
export async function startTest(id: number): Promise<R<{ attempt: number; deadline: string; title: string; instructions: string | null; answers: Record<string, unknown>; questions: { id: number; kind: string; prompt: string; options: string[]; marks: number; negative: number }[] }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_test" as never, { p_test: id } as never);
  if (error) return { ok: false, error: clean(error, "Could not start the test.") };
  return { ok: true, data: data as never };
}
export async function saveAnswer(attempt: number, question: number, value: unknown): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_test_answer" as never, { p_attempt: attempt, p_question: question, p_value: value ?? null } as never);
  if (error) return { ok: false, error: clean(error, "The answer was not saved.") };
  return { ok: true };
}
export async function submitTest(attempt: number): Promise<R<{ score: number; to_mark: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_test" as never, { p_attempt: attempt } as never);
  if (error) return { ok: false, error: clean(error, "Could not submit.") };
  revalidatePath(PATH);
  return { ok: true, data: data as never };
}
export async function markShort(attempt: number, question: number, marks: number): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_short_answer" as never, { p_attempt: attempt, p_question: question, p_marks: marks } as never);
  if (error) return { ok: false, error: clean(error, "Could not save the marks.") };
  revalidatePath(PATH);
  return { ok: true, message: "Marked." };
}
export async function reviewAttempt(attempt: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_attempt" as never, { p_attempt: attempt } as never);
  if (error) return null;
  return data as unknown as { score: number | null; to_mark: number; answers_shown: boolean; questions?: { id: number; kind: string; prompt: string; options: string[]; answer: unknown; marks: number; given: unknown; got: number | null }[] };
}
