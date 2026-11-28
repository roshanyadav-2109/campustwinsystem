"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentYear, getSession } from "@/lib/session";

// Report cards: class teacher and office work. Every rule is enforced again in
// the database (who may enter, lock, publish; locked marks cannot change).
export type Result = { ok: true; message?: string; count?: number } | { ok: false; error: string };
const PATH = "/dashboard/report-cards";
const STAFF = new Set(["office", "principal", "class_teacher"]);

async function ctx() {
  const [session, year] = await Promise.all([getSession(), getCurrentYear()]);
  if (!session || !year || !STAFF.has(session.navRole)) return null;
  return { session, year, supabase: await createClient() };
}
const term = (t: number) => Number.isInteger(t) && t >= 0 && t <= 6;
const msg = (e: { message: string } | null, fallback: string) =>
  e ? (e.message.length < 200 && !e.message.includes("violates") ? e.message : fallback) : fallback;

export type EntryRow = { studentId: number; grades: { areaId: number; grade: string }[]; remark: string; resultText: string; present: string; working: string };

// Grades, remarks, result line and attendance for many students, all or nothing.
export async function saveEntries(input: { term: number; rows: EntryRow[] }): Promise<Result> {
  const c = await ctx();
  if (!c) return { ok: false, error: "You cannot change report cards." };
  if (!term(input.term) || !Array.isArray(input.rows) || input.rows.length > 300) return { ok: false, error: "Choose a term." };
  for (const r of input.rows) {
    const p = r.present.trim(), w = r.working.trim();
    if ((p || w) && (!/^\d{1,3}$/.test(p) || !/^\d{1,3}$/.test(w) || Number(w) < 1 || Number(p) > Number(w)))
      return { ok: false, error: "Attendance: give days present and working days, and present cannot be more than working days." };
  }
  const rows = input.rows.map((r) => ({
    student_id: r.studentId,
    grades: r.grades.map((g) => ({ area_id: g.areaId, grade: g.grade })),
    remark: r.remark.trim().slice(0, 500), result_text: r.resultText.trim().slice(0, 120),
    present: r.present.trim(), working: r.working.trim(),
  }));
  const { error } = await c.supabase.rpc("save_report_entries" as never, { p_year: c.year.id, p_term: input.term, p_rows: rows } as never);
  if (error) return { ok: false, error: msg(error, "Could not save. Nothing was changed.") };
  revalidatePath(PATH);
  return { ok: true, message: `Saved for ${rows.length} ${rows.length === 1 ? "student" : "students"}.` };
}

export async function lockTerm(sectionId: number, t: number): Promise<Result> {
  const c = await ctx();
  if (!c || !term(t) || t === 0) return { ok: false, error: "Choose a term." };
  const { error } = await c.supabase.from("report_lock" as never).insert({ academic_year_id: c.year.id, section_id: sectionId, term: t, locked_by: c.session.staffId } as never);
  if (error && !error.message.includes("duplicate")) return { ok: false, error: msg(error, "Only the office or the class teacher can lock marks.") };
  revalidatePath(PATH);
  return { ok: true, message: "Marks locked for this term. Marks and exams can no longer change until the office unlocks; grades and remarks can still be corrected." };
}

export async function unlockTerm(sectionId: number, t: number): Promise<Result> {
  const c = await ctx();
  if (!c || c.session.staffRole !== "office") return { ok: false, error: "Only the office can unlock marks." };
  const { error } = await c.supabase.from("report_lock" as never).delete().eq("academic_year_id", c.year.id).eq("section_id", sectionId).eq("term", t);
  if (error) return { ok: false, error: "Could not unlock." };
  revalidatePath(PATH);
  return { ok: true, message: "Unlocked. Published cards stay as they are until you publish again." };
}

export async function publishCards(sectionId: number, t: number, studentIds?: number[]): Promise<Result> {
  const c = await ctx();
  if (!c || !term(t)) return { ok: false, error: "Choose a term." };
  const { data, error } = await c.supabase.rpc("publish_report_cards" as never,
    { p_section: sectionId, p_year: c.year.id, p_term: t, p_students: studentIds?.length ? studentIds : null } as never);
  if (error) return { ok: false, error: msg(error, "Could not publish.") };
  revalidatePath(PATH);
  const n = Number(data ?? 0);
  return { ok: true, count: n, message: n ? `${n} report ${n === 1 ? "card" : "cards"} published. Parents are told.` : "Nothing to publish: no marks yet." };
}

export async function withdrawCard(cardId: number, reason: string): Promise<Result> {
  const c = await ctx();
  if (!c || c.session.staffRole !== "office") return { ok: false, error: "Only the office can withdraw a report card." };
  if (!reason.trim()) return { ok: false, error: "Give a reason." };
  const { error } = await c.supabase.from("report_card" as never).update({ status: "withdrawn", withdrawn_reason: reason.trim().slice(0, 200) } as never).eq("id", cardId);
  if (error) return { ok: false, error: msg(error, "Could not withdraw.") };
  revalidatePath(PATH);
  return { ok: true, message: "Withdrawn." };
}

// Published cards of a section for a term (snapshots, for PDF download).
export async function publishedCards(sectionId: number, t: number): Promise<{ ok: true; cards: { snapshot: unknown; token: string; studentId: number }[] } | { ok: false; error: string }> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Not allowed." };
  const { data, error } = await c.supabase.from("report_card" as never).select("snapshot, verify_token, student_id")
    .eq("section_id", sectionId).eq("academic_year_id", c.year.id).eq("term", t).eq("status", "published").limit(1000);
  if (error) return { ok: false, error: "Could not read report cards." };
  return { ok: true, cards: ((data ?? []) as unknown as { snapshot: unknown; verify_token: string; student_id: number }[]).map((r) => ({ snapshot: r.snapshot, token: r.verify_token, studentId: r.student_id })) };
}
