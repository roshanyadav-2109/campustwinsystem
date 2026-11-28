"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";

type R = { ok: true; message: string } | { ok: false; error: string };
const PATH = "/dashboard/schedule/generate";
const clean = (e: { message: string } | null, f: string) => (e && e.message.length < 200 && !/violates|function|relation|column/.test(e.message) ? e.message : f);
async function office() { const s = await getSession(); return !!s && s.staffRole === "office"; }

export type LoadRow = { subjectId: number; periods: number; double: boolean; maxPerDay: number | null };

// How many periods a week each subject has in a class.
export async function saveLoads(yearId: number, classId: number, rows: LoadRow[]): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change the timetable." };
  if (rows.some((r) => !Number.isInteger(r.periods) || r.periods < 0 || r.periods > 40 || (r.maxPerDay != null && (r.maxPerDay < 1 || r.maxPerDay > 8)))) return { ok: false, error: "Periods are whole numbers from 0 to 40; a daily limit is 1 to 8." };
  const supabase = await createClient();
  const db = await untyped();
  const keep = rows.filter((r) => r.periods > 0);
  const { error: e1 } = await db.from("timetable_load").delete().eq("academic_year_id", yearId).eq("class_id", classId);
  if (e1) return { ok: false, error: "Could not save." };
  if (keep.length) {
    const { error } = await db.from("timetable_load").insert(keep.map((r) => ({ academic_year_id: yearId, class_id: classId, subject_id: r.subjectId, periods: r.periods, double_period: r.double, max_per_day: r.maxPerDay })) as never);
    if (error) return { ok: false, error: clean(error, "Could not save.") };
  }
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

// The same weekly periods for other classes (e.g. every section of the middle school).
export async function copyLoads(yearId: number, fromClass: number, toClasses: number[]): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change the timetable." };
  const supabase = await createClient();
  const db = await untyped();
  const { data } = await db.from("timetable_load").select("subject_id, periods, double_period, max_per_day").eq("academic_year_id", yearId).eq("class_id", fromClass);
  const src = (data ?? []) as unknown as { subject_id: number; periods: number; double_period: boolean; max_per_day: number | null }[];
  if (!src.length) return { ok: false, error: "That class has no periods set yet." };
  let n = 0;
  for (const c of toClasses.filter((x) => x !== fromClass)) {
    // only subjects the class actually has
    const { data: cs } = await supabase.from("class_subject").select("subject_id").eq("class_id", c);
    const has = new Set(((cs ?? []) as { subject_id: number }[]).map((x) => x.subject_id));
    await db.from("timetable_load").delete().eq("academic_year_id", yearId).eq("class_id", c);
    const rows = src.filter((r) => has.has(r.subject_id)).map((r) => ({ academic_year_id: yearId, class_id: c, subject_id: r.subject_id, periods: r.periods, double_period: r.double_period, max_per_day: r.max_per_day }));
    if (rows.length) { const { error } = await db.from("timetable_load").insert(rows as never); if (error) return { ok: false, error: clean(error, "Could not copy.") }; }
    n++;
  }
  revalidatePath(PATH);
  return { ok: true, message: `Copied to ${n} class${n === 1 ? "" : "es"}.` };
}

// Periods a teacher cannot take (a fixed duty, part-time days).
export async function saveUnavailable(staffId: number, cells: { day: number; period: number }[]): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change the timetable." };
  const supabase = await createClient();
  const db = await untyped();
  const { error: e1 } = await db.from("staff_unavailable").delete().eq("staff_id", staffId);
  if (e1) return { ok: false, error: "Could not save." };
  if (cells.length) {
    const { error } = await db.from("staff_unavailable").insert(cells.map((c) => ({ staff_id: staffId, day_of_week: c.day, period_no: c.period })) as never);
    if (error) return { ok: false, error: clean(error, "Could not save.") };
  }
  revalidatePath(PATH);
  return { ok: true, message: cells.length ? `${cells.length} period${cells.length === 1 ? "" : "s"} marked not available.` : "Available every period." };
}

export async function saveRules(days: number[], maxPerDay: number, classTeacherFirst: boolean): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change the timetable." };
  if (!days.length) return { ok: false, error: "Choose at least one working day." };
  if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 12) return { ok: false, error: "A teacher's daily limit is 1 to 12 periods." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_timetable_rules" as never, { p_days: days, p_max: maxPerDay, p_ct_first: classTeacherFirst } as never);
  if (error) return { ok: false, error: clean(error, "Could not save.") };
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

export async function saveGenerated(yearId: number, sectionIds: number[], rows: { section_id: number; day: number; period: number; subject_id: number; staff_id: number | null }[]): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change the timetable." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_generated_timetable" as never, { p_year: yearId, p_sections: sectionIds, p_rows: rows } as never);
  if (error) return { ok: false, error: clean(error, "Could not save the timetable.") };
  revalidatePath("/dashboard/schedule");
  revalidatePath(PATH);
  return { ok: true, message: `Saved ${Number(data ?? 0)} lessons for ${sectionIds.length} section${sectionIds.length === 1 ? "" : "s"}.` };
}
