"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

// Switch the central admin's active campus. current_school_id() returns this
// campus, so every page then scopes to it. The DB trigger guarantees the campus
// belongs to the admin's university, so a tampered id is rejected there too.
export async function switchCampus(formData: FormData) {
  const session = await getSession();
  if (!session?.isUniversityAdmin) redirect("/dashboard");

  const campusId = Number(formData.get("campusId"));
  if (!Number.isFinite(campusId) || !session.campuses.some((c) => c.id === campusId)) {
    redirect("/dashboard/university?error=badcampus");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profile").update({ active_campus_id: campusId }).eq("id", session.userId);
  if (error) redirect("/dashboard/university?error=switch");

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

type R = { ok: true; message: string } | { ok: false; error: string };
const clean = (e: { message?: string } | null, fallback: string) => (e?.message && !/[_(]|violates|function|relation/.test(e.message) ? e.message : fallback);

export async function campusSections(campusId: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("campus_sections" as never, { p_school: campusId } as never);
  return (data ?? []) as unknown as { id: number; label: string }[];
}

// Departments, courses and programmes one campus lacks are copied from another (matched by code).
export async function copyCatalogue(from: number, to: number): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_catalogue" as never, { p_from: from, p_to: to } as never);
  if (error) return { ok: false, error: clean(error, "Could not copy.") };
  const d = data as unknown as { departments: number; courses: number; programmes: number };
  return { ok: true, message: `Copied ${d.departments} departments, ${d.courses} courses and ${d.programmes} programmes.` };
}

// A student moves campus: grades and CGPA carry over, the parents and the login come along.
export async function lookupStudent(campusId: number, admissionNo: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("campus_student" as never, { p_school: campusId, p_admission_no: admissionNo.trim() } as never);
  return ((data ?? []) as unknown as { full_name: string; class_label: string | null; status: string }[])[0] ?? null;
}

export async function transferStudent(from: number, admissionNo: string, to: number, sectionId: number, note: string, allowPartial = false): Promise<R> {
  if (!admissionNo.trim()) return { ok: false, error: "Enter the admission number." };
  if (!sectionId) return { ok: false, error: "Choose the section at the new campus." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transfer_student" as never, { p_from: from, p_admission_no: admissionNo.trim(), p_to: to, p_section: sectionId, p_note: note || null, p_allow_partial: allowPartial } as never);
  if (error) return { ok: false, error: clean(error, "Could not transfer.") };
  const d = data as unknown as { admission_no: string; carried: number; not_carried: string | null; cgpa_before: number | null; cgpa_after: number | null };
  revalidatePath("/dashboard/university");
  return { ok: true, message: `Transferred as ${d.admission_no}. ${d.carried} course results carried over.${d.not_carried ? ` Not carried (no matching course or semester at the new campus): ${d.not_carried}.` : ""}${d.cgpa_before !== d.cgpa_after ? ` CGPA ${d.cgpa_before ?? "-"} became ${d.cgpa_after ?? "-"}.` : ""}` };
}
