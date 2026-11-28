"use server";
import { revalidatePath } from "next/cache";
import { getSession, getCurrentYear } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantPrefixForSchool, studentPhotoKey, presignPut, publicUrl, urlUnderPrefix, deleteObject } from "@/lib/r2";

// A student's photo set by the office, the principal or the class teacher (most young children have no login).
type Ticket = { ok: true; uploadUrl: string; publicUrl: string } | { ok: false; error: string };
type Res = { ok: true } | { ok: false; error: string };

async function allowed(studentId: number): Promise<{ schoolId: number } | null> {
  const session = await getSession();
  if (!session?.staffId || !Number.isInteger(studentId) || studentId <= 0) return null;
  const supabase = await createClient();
  // the person must be able to see the student (same institution, row rules)
  const { data: st } = await supabase.from("student").select("id").eq("id", studentId).maybeSingle();
  if (!st) return null;
  if (session.isAdminScope) return { schoolId: session.schoolId };
  const year = await getCurrentYear();
  if (!year) return null;
  const { data: en } = await supabase.from("student_enrollment").select("section_id").eq("student_id", studentId).eq("academic_year_id", year.id).eq("status", "active").maybeSingle();
  if (!en) return null;
  const { data: ct } = await supabase.from("teacher_allotment").select("id").eq("staff_id", session.staffId).eq("section_id", (en as { section_id: number }).section_id)
    .eq("academic_year_id", year.id).eq("is_class_teacher", true).limit(1);
  return ct?.length ? { schoolId: session.schoolId } : null;
}

export async function signStudentPhoto(studentId: number, contentType: string): Promise<Ticket> {
  const a = await allowed(studentId);
  if (!a) return { ok: false, error: "Only the office, the principal or the class teacher can set this photo." };
  if (!/^image\/(jpeg|png)$/.test(contentType)) return { ok: false, error: "Use a JPEG or PNG photo." };
  const key = studentPhotoKey(await tenantPrefixForSchool(a.schoolId), studentId, contentType);
  return { ok: true, uploadUrl: await presignPut(key), publicUrl: publicUrl(key) };
}

export async function saveStudentPhoto(studentId: number, url: string): Promise<Res> {
  const a = await allowed(studentId);
  if (!a) return { ok: false, error: "Only the office, the principal or the class teacher can set this photo." };
  if (!urlUnderPrefix(url, await tenantPrefixForSchool(a.schoolId))) return { ok: false, error: "That photo could not be saved." };
  const admin = createAdminClient();
  const { data: cur } = await admin.from("student").select("photo_path").eq("id", studentId).maybeSingle();
  const old = (cur as { photo_path?: string | null } | null)?.photo_path ?? null;
  if (old && old !== url) await deleteObject(old);
  const { error } = await admin.from("student").update({ photo_path: url }).eq("id", studentId);
  if (error) return { ok: false, error: "That photo could not be saved." };
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}

export async function removeStudentPhoto(studentId: number): Promise<Res> {
  const a = await allowed(studentId);
  if (!a) return { ok: false, error: "Only the office, the principal or the class teacher can remove this photo." };
  const admin = createAdminClient();
  const { data: cur } = await admin.from("student").select("photo_path").eq("id", studentId).maybeSingle();
  await deleteObject((cur as { photo_path?: string | null } | null)?.photo_path ?? null);
  const { error } = await admin.from("student").update({ photo_path: null }).eq("id", studentId);
  if (error) return { ok: false, error: "Could not remove the photo." };
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}

// Bulk upload: admission numbers (from the file names) to students, with whether they have a photo already.
export async function studentsByAdmission(admissionNos: string[]): Promise<Record<string, { id: number; hasPhoto: boolean }>> {
  const session = await getSession();
  if (!session?.isAdminScope) return {};
  const supabase = await createClient();
  const out: Record<string, { id: number; hasPhoto: boolean }> = {};
  const want = [...new Set(admissionNos.map((a) => a.trim()).filter(Boolean))].slice(0, 3000);
  for (let i = 0; i < want.length; i += 300) {
    const { data } = await supabase.from("student").select("id, admission_no, photo_path").in("admission_no", want.slice(i, i + 300));
    for (const r of (data ?? []) as { id: number; admission_no: string; photo_path: string | null }[]) out[r.admission_no.toUpperCase()] = { id: r.id, hasPhoto: !!r.photo_path };
  }
  return out;
}

// Students of a section with no photo, before printing cards.
export async function missingPhotos(sectionId: number): Promise<string[]> {
  const session = await getSession();
  const year = await getCurrentYear();
  if (!session?.staffId || !year) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("student_enrollment").select("student:student_id(full_name, photo_path)").eq("section_id", sectionId).eq("academic_year_id", year.id).eq("status", "active").limit(500);
  return ((data ?? []) as unknown as { student: { full_name: string; photo_path: string | null } | null }[]).filter((r) => r.student && !r.student.photo_path).map((r) => r.student!.full_name);
}

export async function siblingCampuses(): Promise<{ id: number; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("sibling_campuses" as never);
  return (data ?? []) as unknown as { id: number; name: string }[];
}
export async function askTransfer(studentId: number, to: number, reason: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_campus_transfer" as never, { p_student: studentId, p_to: to, p_reason: reason } as never);
  if (error) return { ok: false, error: error.message.length < 160 ? error.message : "Could not send the request." };
  return { ok: true, message: "Sent to central administration. The transfer order follows its approval." };
}
