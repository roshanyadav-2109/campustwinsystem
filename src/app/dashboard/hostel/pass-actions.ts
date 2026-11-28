"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R = { ok: true; message?: string } | { ok: false; error: string };
const clean = (e: { message: string; code?: string } | null, f: string) => (e && (e.code === "P0001" || (e.message.length < 160 && !/violates|function|relation|column/.test(e.message))) ? e.message : f);
const PATH = "/dashboard/hostel";
async function rpc(name: string, args: Record<string, unknown>, ok: string, fail: string): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name as never, args as never);
  if (error) return { ok: false, error: clean(error, fail) };
  revalidatePath(PATH);
  return { ok: true, message: ok };
}
export const askPass = async (studentId: number, kind: string, reason: string, out: string, back: string) =>
  rpc("ask_hostel_pass", { p_student: studentId, p_kind: kind, p_reason: reason, p_out: out, p_back: back }, "Sent to the warden. You will be told the decision.", "Could not send the request.");
export const passStep = async (id: number, step: string, note?: string) =>
  rpc("hostel_pass_step", { p_id: id, p_step: step, p_note: note || null }, step === "approve" ? "Approved; the family is told." : step === "decline" ? "Declined; the family is told." : step === "left" ? "Marked out; the family is told." : step === "back" ? "Marked back; the family is told." : "Done.", "Could not save.");
export async function markRoll(hostelId: number, day: string, absent: number[]): Promise<R> {
  const r = await rpc("mark_hostel_roll", { p_hostel: hostelId, p_day: day, p_absent: absent }, `Roll saved; ${absent.length} absent (their families are told).`, "Could not save the roll.");
  return r;
}
export const setWarden = async (hostelId: number, staffId: number | null) => rpc("set_hostel_warden", { p_hostel: hostelId, p_staff: staffId }, "Saved.", "Could not save.");
