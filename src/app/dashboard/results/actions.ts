"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { isExams } from "@/lib/roles";

type R = { ok: true; message?: string } | { ok: false; error: string };

export async function publishResults(semesterId: number, sectionId: number, reviseReason?: string): Promise<R> {
  const s = await getSession();
  if (!s?.staffRole) return { ok: false, error: "Not allowed." }; // the database decides who publishes
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_semester_results" as never, { p_semester: semesterId, p_section: sectionId, p_revise_reason: reviseReason?.trim().slice(0, 200) || null } as never);
  if (error) return { ok: false, error: error.message.length < 140 ? error.message : "Could not publish." };
  revalidatePath("/dashboard/results");
  const n = Number(data ?? 0);
  return { ok: true, message: n ? (reviseReason ? `Results revised for ${n} students.` : `Results published for ${n} students.`) : "Nothing new to publish: published results stay as they are, and students with missing marks wait." };
}

// Hold back a published result (fees, malpractice...), or release it with an empty reason.
export async function holdResult(semesterId: number, studentId: number, reason: string): Promise<R> {
  const s = await getSession();
  if (!isExams(s)) return { ok: false, error: "Only the office or the exam cell can hold back results." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withhold_result" as never, { p_semester: semesterId, p_student: studentId, p_reason: reason.trim().slice(0, 200) } as never);
  if (error) return { ok: false, error: "Could not change it." };
  revalidatePath("/dashboard/results");
  return { ok: true, message: reason.trim() ? "Held back. The student and parents cannot see it." : "Released." };
}

import { loadCards } from "@/lib/data/results";
export type { GradeCard } from "@/lib/data/results";
type GradeCard_ = import("@/lib/data/results").GradeCard;


// Grade cards of a section (office) for one semester, for the PDF.
export async function sectionGradeCards(semesterId: number, sectionId: number): Promise<{ ok: true; cards: GradeCard_[] } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || !s.staffRole) return { ok: false, error: "Not allowed." };
  const supabase = await createClient();
  const { data: kids } = await supabase.from("student_enrollment").select("student_id").eq("section_id", sectionId).limit(1000);
  const ids = (kids ?? []).map((k) => k.student_id);
  return { ok: true, cards: await loadCards(supabase, semesterId, ids, s.school.name) };
}

export async function requestRevaluation(resultId: number, kind: "revaluation" | "retotalling"): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_revaluation" as never, { p_result: resultId, p_kind: kind } as never);
  if (error) return { ok: false, error: error.message.length < 140 ? error.message : "Could not send the request." };
  revalidatePath("/dashboard/results"); revalidatePath("/dashboard/revaluation");
  return { ok: true, message: "Requested. Any fee appears under Fees; the exam cell decides after it is paid." };
}

export async function decideRevaluation(id: number, newEse: string, note: string): Promise<R> {
  if (newEse.trim() && !/^\d{1,3}(\.\d{1,2})?$/.test(newEse.trim())) return { ok: false, error: "Marks are a number." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_revaluation" as never, { p_id: id, p_new_ese: newEse.trim() ? Number(newEse) : null, p_note: note.trim() || null } as never);
  if (error) return { ok: false, error: error.message.length < 160 ? error.message : "Could not save." };
  revalidatePath("/dashboard/revaluation"); revalidatePath("/dashboard/results");
  return { ok: true, message: data === "revised" ? "Revised. The grade card now shows the new result." : "No change recorded." };
}

export async function consolidatedData(studentId: number) {
  const supabase = await createClient();
  const [{ data: rows }, { data: st }, { data: me }] = await Promise.all([
    supabase.rpc("student_consolidated" as never, { p_student: studentId } as never),
    supabase.rpc("student_standing" as never, { p_student: studentId } as never),
    supabase.from("student").select("full_name, admission_no").eq("id", studentId).maybeSingle(),
  ]);
  const standing = ((st ?? []) as unknown as { cgpa: number | null; credits_earned: number; backlogs: number }[])[0] ?? null;
  const { data: pct } = standing?.cgpa != null ? await supabase.rpc("cgpa_percent" as never, { p_cgpa: standing.cgpa } as never) : { data: null };
  const { data: prog } = await supabase.from("student_enrollment").select("section:section_id(class:class_id(programme:programme_id(name)))" as "student_id").eq("student_id", studentId).eq("status", "active").limit(1).maybeSingle();
  const session = await getSession();
  return {
    student: { name: me?.full_name ?? "", admission_no: me?.admission_no ?? "", programme: (prog as unknown as { section: { class: { programme: { name: string } | null } } } | null)?.section?.class?.programme?.name ?? null, school: session?.school.name ?? "" },
    rows: (rows ?? []) as unknown as import("@/components/courses/grade-card-pdf").ConsolidatedRow[], standing, percent: pct == null ? null : Number(pct),
  };
}

export async function suppMemoData(studentId: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("student_supp_results" as never, { p_student: studentId } as never);
  return (data ?? []) as unknown as import("@/components/courses/grade-card-pdf").SuppResultRow[];
}

export async function rankList(semesterId: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("rank_list" as never, { p_semester: semesterId, p_programme: null } as never);
  return (data ?? []) as unknown as { rank: number; student_name: string; admission_no: string; programme: string; sgpa: number }[];
}
