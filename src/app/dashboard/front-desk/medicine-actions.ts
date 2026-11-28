"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R = { ok: true; message: string } | { ok: false; error: string };
const PATH = "/dashboard/front-desk";
const clean = (e: { message: string; code?: string } | null, f: string) => (e && (e.code === "P0001" || (e.message.length < 160 && !/violates|function|relation|column/.test(e.message))) ? e.message : f);

export async function addMedicine(input: { studentId: number | null; admissionNo: string; medicine: string; dose: string; times: string[]; from: string; to: string; instructions: string; doctor: string; consent: boolean }): Promise<R> {
  if (!input.medicine.trim() || !input.dose.trim()) return { ok: false, error: "Give the medicine and the dose." };
  const times = input.times.map((t) => t.trim()).filter(Boolean);
  if (!times.length || times.some((t) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t))) return { ok: false, error: "Times are like 10:30 or 13:00, separated by commas." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) return { ok: false, error: "Give the first and last day." };
  const supabase = await createClient();
  let studentId = input.studentId;
  if (!studentId) {
    const { data: st } = await supabase.from("student").select("id").eq("admission_no", input.admissionNo.trim()).maybeSingle();
    if (!st) return { ok: false, error: "No student with that admission number." };
    studentId = st.id;
  }
  const { error } = await supabase.rpc("add_medicine" as never, { p_student: studentId, p_medicine: input.medicine, p_dose: input.dose, p_times: times, p_from: input.from, p_to: input.to,
    p_instructions: input.instructions || null, p_doctor: input.doctor || null, p_consent: input.consent } as never);
  if (error) return { ok: false, error: clean(error, "Could not add the medicine.") };
  revalidatePath(PATH);
  return { ok: true, message: "Added. It shows on the school's list of doses for those days." };
}

export async function stopMedicine(id: number): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("stop_medicine" as never, { p_id: id } as never);
  if (error) return { ok: false, error: clean(error, "Could not stop it.") };
  revalidatePath(PATH);
  return { ok: true, message: "Stopped." };
}

export async function recordDose(medicineId: number, at: string, status: "given" | "refused" | "missed", note: string): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_dose" as never, { p_medicine: medicineId, p_at: at, p_status: status, p_note: note || null } as never);
  if (error) return { ok: false, error: clean(error, "Could not record the dose.") };
  revalidatePath(PATH);
  return { ok: true, message: "Recorded; the family is told." };
}
