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
  const { data, error } = await supabase.from("visitor" as never).update({ out_at: new Date().toISOString() } as never).eq("id", id).is("out_at", null).select("id");
  if (error || !(data as unknown[] | null)?.length) return { ok: false, error: "Already signed out." };
  revalidatePath(PATH);
  return { ok: true, message: "Signed out." };
}

export async function requestGatePass(input: { studentId: number; reason: string; pickupName: string; relation: string; phone: string; leaveAt: string }): Promise<R> {
  const s = await getSession();
  if (!s || s.role === "student") return { ok: false, error: "A parent or the school office asks for an early pick-up." };
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
  const staff = s.staffRole === "office" || s.staffRole === "principal";
  if (status !== "cancelled" && !staff) return { ok: false, error: "Only the office decides gate passes." };
  const expected = status === "left" ? "approved" : status === "cancelled" ? (staff ? null : "requested") : "requested";
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "approved" || status === "rejected") { patch.decided_by = s.staffId; patch.decision_note = t(note, 200) || null; }
  if (status === "left") patch.left_at = new Date().toISOString();
  let q = supabase.from("gate_pass" as never).update(patch as never).eq("id", id);
  if (expected) q = q.eq("status", expected);
  const { data, error } = await q.select("id");
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
  // sent home: a gate pass is raised and approved, so the gate knows the child may leave
  if (input.sentHome) {
    const { data: gp } = await supabase.from("gate_pass" as never).insert({ student_id: input.studentId, reason: `Sent home from the health room: ${t(input.complaint, 150)}`,
      pickup_name: "Parent or guardian", leave_at: new Date().toISOString() } as never).select("id").single();
    const gpId = (gp as { id: number } | null)?.id;
    if (gpId) await supabase.from("gate_pass" as never).update({ status: "approved", decided_by: s.staffId } as never).eq("id", gpId);
  }
  revalidatePath(PATH);
  return { ok: true, message: input.tellParent ? "Saved. The parents are told." : "Saved." };
}

export async function studentHealth(studentId: number): Promise<{ blood_group: string | null; allergies: string | null; medical_notes: string | null; emergency: string | null } | null> {
  if (!(await staffOnly())) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("student_profile" as never).select("blood_group, allergies, medical_notes, emergency_name, emergency_phone").eq("student_id", studentId).maybeSingle();
  const p = data as unknown as { blood_group: string | null; allergies: string | null; medical_notes: string | null; emergency_name: string | null; emergency_phone: string | null } | null;
  return p ? { blood_group: p.blood_group, allergies: p.allergies, medical_notes: p.medical_notes, emergency: [p.emergency_name, p.emergency_phone].filter(Boolean).join(", ") || null } : null;
}

export async function findStudents(q: string): Promise<{ id: number; name: string; admission_no: string }[]> {
  if (!(await staffOnly()) || q.trim().length < 2) return [];
  const supabase = await createClient();
  const like = `%${q.trim().replace(/[%_]/g, "")}%`;
  const { data } = await supabase.from("student").select("id, full_name, admission_no").eq("status", "active").or(`full_name.ilike.${like},admission_no.ilike.${like}`).limit(10);
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name, admission_no: s.admission_no }));
}
