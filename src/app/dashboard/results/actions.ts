"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

type R = { ok: true; message?: string } | { ok: false; error: string };

export async function publishResults(semesterId: number, sectionId: number): Promise<R> {
  const s = await getSession();
  if (s?.staffRole !== "office") return { ok: false, error: "Only the office can publish results." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_semester_results" as never, { p_semester: semesterId, p_section: sectionId } as never);
  if (error) return { ok: false, error: error.message.length < 140 ? error.message : "Could not publish." };
  revalidatePath("/dashboard/results");
  const n = Number(data ?? 0);
  return { ok: true, message: n ? `Results published for ${n} students.` : "Nothing to publish: marks are still missing." };
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
