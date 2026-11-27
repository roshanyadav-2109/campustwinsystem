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
