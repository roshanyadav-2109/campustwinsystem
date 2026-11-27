"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R = { ok: true; message?: string } | { ok: false; error: string };
const clean = (e: { message: string }) => (e.message.length < 140 && !e.message.includes("violates") ? e.message : "Could not save.");

export async function markCourseLecture(input: { subjectId: number; date: string; period: number; absent: number[] }): Promise<R> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isInteger(input.period) || input.period < 1 || input.period > 12) return { ok: false, error: "Choose the date and period." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_course_lecture" as never, { p_subject: input.subjectId, p_date: input.date, p_period: input.period, p_absent: input.absent } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath("/dashboard/lectures");
  return { ok: true, message: `Saved for ${Number(data ?? 0)} students; ${input.absent.length} absent.` };
}

export async function markLecture(input: { sectionId: number; subjectId: number; date: string; period: number; absent: number[] }): Promise<R> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isInteger(input.period) || input.period < 1 || input.period > 12) return { ok: false, error: "Choose the date and period." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_lecture" as never, { p_section: input.sectionId, p_subject: input.subjectId, p_date: input.date, p_period: input.period, p_absent: input.absent } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath("/dashboard/lectures");
  return { ok: true, message: `Saved for ${Number(data ?? 0)} students; ${input.absent.length} absent.` };
}
