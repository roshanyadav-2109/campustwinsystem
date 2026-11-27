"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R = { ok: true; message?: string } | { ok: false; error: string };
const PATH = "/dashboard/courses";
const clean = (e: { message: string }) => (e.message.length < 140 && !e.message.includes("violates") ? e.message : "Could not save.");

export async function registerCore(semesterId: number): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_core_courses" as never, { p_semester: semesterId } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: `${Number(data ?? 0)} core course registrations added.` };
}
export async function chooseCourse(semesterId: number, studentId: number, pcId: number): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_course" as never, { p_semester: semesterId, p_student: studentId, p_pc: pcId } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: "Registered." };
}
export async function dropCourse(semesterId: number, studentId: number, pcId: number): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("drop_course" as never, { p_semester: semesterId, p_student: studentId, p_pc: pcId } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: "Dropped." };
}
export async function approveAll(semesterId: number, ids: number[]): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_registrations" as never, { p_semester: semesterId, p_ids: ids.slice(0, 5000) } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: `${Number(data ?? 0)} approved.` };
}

export async function rejectChoice(semesterId: number, id: number, reason: string): Promise<R> {
  if (reason.trim().length < 3) return { ok: false, error: "Give the reason." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reject_registrations" as never, { p_semester: semesterId, p_ids: [id], p_reason: reason.trim().slice(0, 200) } as never);
  if (error) return { ok: false, error: clean(error) };
  revalidatePath(PATH);
  return { ok: true, message: Number(data ?? 0) ? "Rejected; the student can choose again." : "Already decided." };
}
