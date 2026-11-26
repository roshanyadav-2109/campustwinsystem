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

export async function saveEntry(input: {
  studentId: number; term: number;
  grades: { areaId: number; grade: string }[];
  remark: string; resultText: string; present: string; working: string;
}): Promise<Result> {
  const c = await ctx();
  if (!c) return { ok: false, error: "You cannot change report cards." };
  if (!term(input.term) || !Number.isInteger(input.studentId)) return { ok: false, error: "Choose a student and a term." };
  const { supabase, year } = c;
  const yid = year.id, sid = input.studentId;
  for (const g of input.grades) {
    if (!g.grade) {
      await supabase.from("report_coscholastic_grade" as never).delete().eq("student_id", sid).eq("academic_year_id", yid).eq("area_id", g.areaId).eq("term", input.term);
      continue;
    }
    const { error } = await supabase.from("report_coscholastic_grade" as never)
      .upsert({ academic_year_id: yid, student_id: sid, area_id: g.areaId, term: input.term, grade: g.grade, entered_by: c.session.staffId, updated_at: new Date().toISOString() } as never,
        { onConflict: "student_id,academic_year_id,area_id,term" });
    if (error) return { ok: false, error: msg(error, "Could not save the grades.") };
  }
  const remark = input.remark.trim().slice(0, 500), resultText = input.resultText.trim().slice(0, 120);
  if (remark || resultText) {
    const { error } = await supabase.from("report_remark" as never)
      .upsert({ academic_year_id: yid, student_id: sid, term: input.term, remark: remark || "", result_text: resultText || null, entered_by: c.session.staffId, updated_at: new Date().toISOString() } as never,
        { onConflict: "student_id,academic_year_id,term" });
    if (error) return { ok: false, error: msg(error, "Could not save the remark.") };
  } else {
    await supabase.from("report_remark" as never).delete().eq("student_id", sid).eq("academic_year_id", yid).eq("term", input.term);
  }
  const p = input.present.trim(), w = input.working.trim();
  if (p || w) {
    if (!/^\d{1,3}$/.test(p) || !/^\d{1,3}$/.test(w) || Number(w) < 1 || Number(p) > Number(w)) return { ok: false, error: "Attendance: days present cannot be more than working days." };
    const { error } = await supabase.from("report_attendance" as never)
      .upsert({ academic_year_id: yid, student_id: sid, term: input.term, present: Number(p), working: Number(w) } as never, { onConflict: "student_id,academic_year_id,term" });
    if (error) return { ok: false, error: msg(error, "Could not save attendance.") };
  } else {
    await supabase.from("report_attendance" as never).delete().eq("student_id", sid).eq("academic_year_id", yid).eq("term", input.term);
  }
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

export async function lockTerm(sectionId: number, t: number): Promise<Result> {
  const c = await ctx();
  if (!c || !term(t) || t === 0) return { ok: false, error: "Choose a term." };
  const { error } = await c.supabase.from("report_lock" as never).insert({ academic_year_id: c.year.id, section_id: sectionId, term: t, locked_by: c.session.staffId } as never);
  if (error && !error.message.includes("duplicate")) return { ok: false, error: msg(error, "Only the office or the class teacher can lock marks.") };
  revalidatePath(PATH);
  return { ok: true, message: "Marks locked for this term. Nobody can change them until the office unlocks." };
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
export async function publishedCards(sectionId: number, t: number): Promise<{ ok: true; cards: { snapshot: unknown; token: string }[] } | { ok: false; error: string }> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Not allowed." };
  const { data, error } = await c.supabase.from("report_card" as never).select("snapshot, verify_token")
    .eq("section_id", sectionId).eq("academic_year_id", c.year.id).eq("term", t).eq("status", "published").limit(1000);
  if (error) return { ok: false, error: "Could not read report cards." };
  return { ok: true, cards: ((data ?? []) as unknown as { snapshot: unknown; verify_token: string }[]).map((r) => ({ snapshot: r.snapshot, token: r.verify_token })) };
}
