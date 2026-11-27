"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { setsAttendanceRules } from "@/lib/roles";

type R = { ok: true; message?: string } | { ok: false; error: string };
const clean = (e: { message: string }, f: string) => (e.message.length < 160 && !e.message.includes("violates") ? e.message : f);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const refresh = () => { revalidatePath("/dashboard/relaxations"); revalidatePath("/dashboard/lectures"); };

// Ask for attendance to be relaxed in one course, a fee extension, or a locked lecture day to be opened.
export async function askRelaxation(input: { kind: "attendance" | "fees" | "unlock"; studentId?: number | null; subjectId?: number | null; sectionId?: number | null; date?: string | null; until?: string | null; reason: string; direct?: boolean }): Promise<R> {
  if (!(await getSession())?.staffRole) return { ok: false, error: "Only staff can ask for a relaxation." };
  if (input.reason.trim().length < 3) return { ok: false, error: "Give the reason." };
  if (input.kind === "unlock" && !(input.date && DATE.test(input.date))) return { ok: false, error: "Choose the day." };
  if (input.kind === "fees" && !(input.until && DATE.test(input.until))) return { ok: false, error: "Give the date by which the fees will be paid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_relaxation" as never, {
    p_kind: input.kind, p_student: input.studentId ?? null, p_subject: input.subjectId ?? null, p_section: input.sectionId ?? null,
    p_date: input.date ?? null, p_until: input.until ?? null, p_reason: input.reason.trim().slice(0, 300), p_override: !!input.direct,
  } as never);
  if (error) return { ok: false, error: clean(error, "Could not send the request.") };
  refresh();
  return { ok: true, message: input.direct ? "Approved." : "Sent for approval." };
}

// The office asks for a fee extension for a student, found by admission number.
export async function askFeeExtension(admissionNo: string, until: string, reason: string, direct = false): Promise<R> {
  const s = await getSession();
  if (!s?.staffRole) return { ok: false, error: "Not allowed." };
  const supabase = await createClient();
  const { data: st } = await supabase.from("student").select("id").eq("admission_no", admissionNo.trim()).maybeSingle();
  if (!st) return { ok: false, error: "No student with this admission number." };
  return askRelaxation({ kind: "fees", studentId: st.id, until, reason, direct });
}

export async function decideRelaxation(id: number, approve: boolean, note: string): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_relaxation" as never, { p_id: id, p_approve: approve, p_note: note.trim().slice(0, 300) || null } as never);
  if (error) return { ok: false, error: clean(error, "Could not save.") };
  refresh();
  const r = String(data);
  return { ok: true, message: r === "approved" ? "Approved." : r === "rejected" ? "Rejected." : "Approved and sent to the next person." };
}

export async function revokeRelaxation(id: number, reason: string): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_relaxation" as never, { p_id: id, p_reason: reason.trim().slice(0, 300) } as never);
  if (error) return { ok: false, error: clean(error, "Could not withdraw.") };
  refresh();
  return { ok: true, message: "Withdrawn. The hold applies again." };
}

export async function cancelRelaxation(id: number): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_relaxation" as never, { p_id: id } as never);
  if (error) return { ok: false, error: clean(error, "Could not cancel.") };
  refresh();
  return { ok: true, message: "Cancelled." };
}

export async function saveAttendanceRules(input: { mode: string; days: string; minimum: string; floor: string; holdFees: boolean; cutoff: string; chain: Record<string, string[]> }): Promise<R> {
  const s = await getSession();
  if (!setsAttendanceRules(s)) return { ok: false, error: "Only the office, the principal or the examinations head can change these rules." };
  if (!["none", "daily", "cutoff", "both"].includes(input.mode)) return { ok: false, error: "Choose how attendance locks." };
  const days = Number(input.days), min = Number(input.minimum), floor = input.floor.trim() ? Number(input.floor) : null;
  if (!Number.isInteger(days) || days < 0 || days > 60) return { ok: false, error: "Days to correct: 0 to 60." };
  if (!(min >= 0 && min <= 100) || (floor != null && !(floor >= 0 && floor <= min))) return { ok: false, error: "The floor must be a percentage below the minimum." };
  if ((input.mode === "cutoff" || input.mode === "both") && !DATE.test(input.cutoff)) return { ok: false, error: "Give the attendance cut-off date for this semester." };
  for (const k of ["attendance", "fees", "unlock"]) if (!input.chain[k]?.length) return { ok: false, error: "Every request needs at least one approver." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_attendance_rules" as never, { p_mode: input.mode, p_days: days, p_minimum: min, p_floor: floor, p_hold_fees: input.holdFees,
    p_chain: input.chain, p_cutoff: DATE.test(input.cutoff) ? input.cutoff : null } as never);
  if (error) return { ok: false, error: clean(error, "Could not save.") };
  revalidatePath("/dashboard/settings/attendance-rules");
  return { ok: true, message: "Saved." };
}

// approve the requests shown on screen (one kind at a time), in one call
export async function approveMany(ids: number[]): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_relaxations" as never, { p_ids: ids.slice(0, 300), p_note: "Approved with others" } as never);
  if (error) return { ok: false, error: clean(error, "Could not approve.") };
  refresh();
  const n = Number(data ?? 0);
  return n === ids.length ? { ok: true, message: `Approved ${n}.` } : { ok: false, error: `Approved ${n}; ${ids.length - n} were no longer waiting for you.` };
}

export async function saveCondonationFee(fee: string): Promise<R> {
  if (fee.trim() && !/^\d{1,6}(\.\d{1,2})?$/.test(fee.trim())) return { ok: false, error: "The fee is an amount in rupees." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_condonation_fee" as never, { p_fee: fee.trim() ? Number(fee) : null } as never);
  if (error) return { ok: false, error: clean(error, "Could not save.") };
  revalidatePath("/dashboard/settings/attendance-rules");
  return { ok: true, message: "Saved." };
}
