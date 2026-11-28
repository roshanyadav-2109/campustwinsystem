"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession, getCurrentYear } from "@/lib/session";

export async function applyLeave(input: { studentId: number; fromDate: string; toDate: string; reason: string }) {
  const supabase = await createClient();
  const session = await getSession();
  const year = await getCurrentYear();
  if (!session || !year) return { ok: false, error: "Not permitted" };

  const { data: enr } = await supabase
    .from("student_enrollment")
    .select("section_id")
    .eq("student_id", input.studentId)
    .eq("academic_year_id", year.id)
    .single();
  if (!enr) return { ok: false, error: "Student not enrolled this year" };

  const { error } = await supabase.from("leave_application").insert({
    student_id: input.studentId,
    section_id: enr.section_id,
    academic_year_id: year.id,
    applied_by: session.userId,
    from_date: input.fromDate,
    to_date: input.toDate,
    reason: input.reason,
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/leave");
  return { ok: true };
}

// Student/guardian supplies the reason for an auto-created absence notice.
export async function explainAbsence(id: number, reason: string) {
  const supabase = await createClient();
  const session = await getSession();
  const { error } = await supabase
    .from("absence_notice")
    .update({ reason, status: "explained", explained_by: session?.userId ?? null, explained_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/leave");
  return { ok: true };
}

// Apply the same reason to several absent days at once.
export async function explainAbsences(ids: number[], reason: string) {
  if (!ids.length) return { ok: true };
  const supabase = await createClient();
  const session = await getSession();
  const { error } = await supabase
    .from("absence_notice")
    .update({ reason, status: "explained", explained_by: session?.userId ?? null, explained_at: new Date().toISOString() })
    .in("id", ids);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/leave");
  return { ok: true };
}

export async function decideLeave(id: number, status: "approved" | "rejected", note?: string) {
  const supabase = await createClient();
  const session = await getSession();
  const { error } = await supabase
    .from("leave_application")
    .update({ status, decided_by: session?.staffId ?? null, decided_at: new Date().toISOString(), decision_note: note ?? null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/leave");
  return { ok: true };
}

// Leave with a kind (leave; in colleges also medical or on duty) and proof uploaded to the student's own folder.
const PROOF: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
export async function signLeaveProof(studentId: number, contentType: string, size: number): Promise<{ ok: true; key: string; uploadUrl: string } | { ok: false; error: string }> {
  const ext = PROOF[contentType];
  if (!ext) return { ok: false, error: "Upload a PDF, JPG or PNG." };
  if (size > 10 * 1024 * 1024) return { ok: false, error: "The file is over 10 MB." };
  const supabase = await createClient();
  const { data: school } = await supabase.rpc("leave_upload_ok" as never, { p_student: studentId } as never);
  if (!school) return { ok: false, error: "Not allowed." };
  const { presignPrivatePut, tenantPrefixForSchool } = await import("@/lib/r2");
  const key = `${await tenantPrefixForSchool(Number(school))}/students/${studentId}/leave/${crypto.randomUUID()}.${ext}`;
  return { ok: true, key, uploadUrl: await presignPrivatePut(key) };
}
export async function applyStudentLeave(input: { studentId: number; fromDate: string; toDate: string; reason: string; kind: "leave" | "medical" | "on_duty"; fileKey: string | null }) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_student_leave" as never, { p_student: input.studentId, p_from: input.fromDate, p_to: input.toDate, p_reason: input.reason, p_kind: input.kind, p_file_key: input.fileKey } as never);
  if (error) return { ok: false as const, error: error.message.length < 160 ? error.message : "Could not send the request." };
  revalidatePath("/dashboard/leave");
  return { ok: true as const };
}
export async function leaveProofLink(leaveId: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("leave_file_key" as never, { p_leave: leaveId } as never);
  if (!data) return { ok: false, error: "Not available." };
  const { presignGet } = await import("@/lib/r2");
  return { ok: true, url: await presignGet(String(data)) };
}
