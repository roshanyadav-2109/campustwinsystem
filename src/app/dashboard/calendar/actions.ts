"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession, getCurrentYear } from "@/lib/session";

// The school calendar: holidays, exams, parent-teacher meetings and activities.
// The principal and the office keep it; everyone sees what applies to them.
// A holiday here is used elsewhere too: the attendance register opens as a
// holiday, and staff leave does not count it.

export type Result = { ok: true } | { ok: false; error: string };
export type EventKind = "holiday" | "exam" | "ptm" | "activity" | "other";
const KINDS: EventKind[] = ["holiday", "exam", "ptm", "activity", "other"];

export type EventInput = {
  id?: number | null;
  title: string;
  kind: EventKind;
  from: string;          // YYYY-MM-DD
  to: string;            // YYYY-MM-DD, same as from for one day
  classId: number | null;
  sectionId: number | null;
  description: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (s: string) => ISO.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

async function leaderSession() {
  const session = await getSession();
  if (!session?.staffId || (session.staffRole !== "principal" && session.staffRole !== "office")) return null;
  return session;
}

function refresh() {
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/attendance");
}

export async function saveEvent(input: EventInput): Promise<Result> {
  const session = await leaderSession();
  if (!session) return { ok: false, error: "Only the principal or the office can change the calendar." };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No school year is set up yet." };
  const title = (input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!title) return { ok: false, error: "Please type a name, like Diwali holidays." };
  if (!KINDS.includes(input.kind)) return { ok: false, error: "Choose what kind of day this is." };
  if (!realDate(input.from)) return { ok: false, error: "Choose the start date." };
  const to = input.to && realDate(input.to) ? input.to : input.from;
  if (to < input.from) return { ok: false, error: "The end date cannot be before the start date." };

  const supabase = await createClient();
  // Applies to: whole school, a class, or one section of it.
  let classId: number | null = null, sectionId: number | null = null;
  if (input.sectionId) {
    const { data: sec } = await supabase.from("section").select("id, class_id").eq("id", input.sectionId).maybeSingle();
    if (!sec) return { ok: false, error: "That section was not found." };
    sectionId = sec.id; classId = null;
  } else if (input.classId) {
    const { data: cls } = await supabase.from("class").select("id").eq("id", input.classId).maybeSingle();
    if (!cls) return { ok: false, error: "That class was not found." };
    classId = cls.id;
  }

  const row = {
    title, event_type: input.kind, start_date: input.from, end_date: to,
    class_id: classId, section_id: sectionId,
    description: (input.description ?? "").trim().slice(0, 2000) || null,
  };
  if (input.id) {
    const { data, error } = await supabase.from("event").update(row).eq("id", input.id).select("id");
    if (error || !data?.length) return { ok: false, error: "This could not be saved. Please try again." };
  } else {
    const { error } = await supabase.from("event").insert({ ...row, academic_year_id: year.id, created_by: session.staffId });
    if (error) return { ok: false, error: "This could not be saved. Please try again." };
  }
  refresh();
  return { ok: true };
}

export async function deleteEvent(id: number): Promise<Result> {
  const session = await leaderSession();
  if (!session) return { ok: false, error: "Only the principal or the office can change the calendar." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("event").delete().eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: "This could not be removed. Please try again." };
  refresh();
  return { ok: true };
}

// The national holidays that fall on fixed dates, added for the current school
// year in one go. Festivals move each year, so those are added by the school.
export async function addNationalHolidays(): Promise<Result & { added?: number }> {
  const session = await leaderSession();
  if (!session) return { ok: false, error: "Only the principal or the office can change the calendar." };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No school year is set up yet." };
  const supabase = await createClient();
  const { data: yr } = await supabase.from("academic_year").select("start_date, end_date").eq("id", year.id).maybeSingle();
  if (!yr?.start_date || !yr?.end_date) return { ok: false, error: "The school year has no dates set." };
  const start = yr.start_date as string, end = yr.end_date as string;
  const y0 = Number(start.slice(0, 4)), y1 = Number(end.slice(0, 4));
  const wanted: { title: string; date: string }[] = [];
  for (let y = y0; y <= y1; y++) {
    wanted.push({ title: "Republic Day", date: `${y}-01-26` }, { title: "Independence Day", date: `${y}-08-15` }, { title: "Gandhi Jayanti", date: `${y}-10-02` });
  }
  const inYear = wanted.filter((w) => w.date >= start && w.date <= end);
  const { data: existing } = await supabase.from("event").select("start_date, title").eq("event_type", "holiday")
    .gte("start_date", start).lte("start_date", end);
  const have = new Set((existing ?? []).map((e) => e.start_date));
  const rows = inYear.filter((w) => !have.has(w.date)).map((w) => ({
    title: w.title, event_type: "holiday" as const, start_date: w.date, end_date: w.date,
    academic_year_id: year.id, created_by: session.staffId,
  }));
  if (rows.length) {
    const { error } = await supabase.from("event").insert(rows);
    if (error) return { ok: false, error: "The holidays could not be added. Please try again." };
  }
  refresh();
  return { ok: true, added: rows.length };
}
