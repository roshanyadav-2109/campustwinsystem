"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

// Front desk: visitors, gate passes and the health room. The database decides
// who may do what (office / principal; parents only for their own child).
type R = { ok: true; message?: string } | { ok: false; error: string };
const PATH = "/dashboard/front-desk";
const t = (v: string, n: number) => v.trim().slice(0, n);
const staffOnly = async () => { const s = await getSession(); return s && (s.staffRole === "office" || s.staffRole === "principal") ? s : null; };

export async function addVisitor(input: { name: string; phone: string; purpose: string; meeting: string; idProof: string; vehicle: string; badge: string }): Promise<R> {
  const s = await staffOnly();
  if (!s) return { ok: false, error: "Only the office can keep the visitor log." };
  if (!input.name.trim()) return { ok: false, error: "Enter the visitor's name." };
  const supabase = await createClient();
  const { error } = await supabase.from("visitor" as never).insert({ name: t(input.name, 80), phone: t(input.phone, 16) || null, purpose: t(input.purpose, 120) || null,
    meeting: t(input.meeting, 80) || null, id_proof: t(input.idProof, 60) || null, vehicle: t(input.vehicle, 20) || null, badge_no: t(input.badge, 20) || null, created_by: s.staffId } as never);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath(PATH);
  return { ok: true, message: "Signed in." };
}

export async function visitorOut(id: number): Promise<R> {
  if (!(await staffOnly())) return { ok: false, error: "Not allowed." };
  const supabase = await createClient();
  const { error } = await supabase.from("visitor" as never).update({ out_at: new Date().toISOString() } as never).eq("id", id).is("out_at", null);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath(PATH);
  return { ok: true, message: "Signed out." };
}

export async function requestGatePass(input: { studentId: number; reason: string; pickupName: string; relation: string; phone: string; leaveAt: string }): Promise<R> {
  if (!(await getSession())) return { ok: false, error: "Please sign in again." };
  if (!input.reason.trim() || !input.pickupName.trim()) return { ok: false, error: "Give the reason and who will pick the child up." };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.leaveAt)) return { ok: false, error: "Choose the date and time." };
  const supabase = await createClient();
  const { error } = await supabase.from("gate_pass" as never).insert({ student_id: input.studentId, reason: t(input.reason, 200), pickup_name: t(input.pickupName, 80),
    pickup_relation: t(input.relation, 40) || null, pickup_phone: t(input.phone, 16) || null, leave_at: `${input.leaveAt}:00+05:30` } as never);
  if (error) return { ok: false, error: "Could not send the request." };
  revalidatePath(PATH);
  return { ok: true, message: "Sent to the school office." };
}

export async function decideGatePass(id: number, status: "approved" | "rejected" | "left" | "cancelled", note: string): Promise<R> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "approved" || status === "rejected") { patch.decided_by = s.staffId; patch.decision_note = t(note, 200) || null; }
  if (status === "left") patch.left_at = new Date().toISOString();
  const { data, error } = await supabase.from("gate_pass" as never).update(patch as never).eq("id", id).select("id");
  if (error || !(data as unknown[] | null)?.length) return { ok: false, error: "Not allowed." };
  revalidatePath(PATH);
  return { ok: true, message: status === "approved" ? "Approved. The parents are told." : status === "left" ? "Recorded. The parents are told." : status === "rejected" ? "Not approved. The parents are told." : "Cancelled." };
}

export async function addHealthVisit(input: { studentId: number; complaint: string; action: string; sentHome: boolean; tellParent: boolean }): Promise<R> {
  const s = await staffOnly();
  if (!s) return { ok: false, error: "Only the office can record health room visits." };
  if (!input.complaint.trim()) return { ok: false, error: "Write what the problem was." };
  const supabase = await createClient();
  const { error } = await supabase.from("health_visit" as never).insert({ student_id: input.studentId, complaint: t(input.complaint, 200), action_taken: t(input.action, 300) || null,
    sent_home: input.sentHome, tell_parent: input.tellParent, recorded_by: s.staffId } as never);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath(PATH);
  return { ok: true, message: input.tellParent ? "Saved. The parents are told." : "Saved." };
}

export async function findStudents(q: string): Promise<{ id: number; name: string; admission_no: string }[]> {
  if (!(await staffOnly()) || q.trim().length < 2) return [];
  const supabase = await createClient();
  const like = `%${q.trim().replace(/[%_]/g, "")}%`;
  const { data } = await supabase.from("student").select("id, full_name, admission_no").eq("status", "active").or(`full_name.ilike.${like},admission_no.ilike.${like}`).limit(10);
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name, admission_no: s.admission_no }));
}
