"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentYear, getSession } from "@/lib/session";

// Settings → Report cards. The office defines schemes and chooses which class
// (or section) uses which. The database checks every rule again.
export type Result = { ok: true; id?: number; message?: string } | { ok: false; error: string };

export type SchemeInput = {
  id?: number | null;
  name: string; board: string; pass_percent: string; overall_pass_percent: string;
  show_marks: boolean; show_grades: boolean; show_percent: boolean; final_label: string;
  terms: { term: number; name: string; starts_on: string; ends_on: string }[];
  components: { id?: number | null; term: number; name: string; assessment_type_id: number; rule: "sum" | "average" | "best"; best_n: string; out_of: string; sort: number; subject_ids: number[] }[];
  bands: { min_percent: string; grade: string; grade_point: string; remark: string }[];
  areas: { id?: number | null; name: string; grades: string[]; sort: number }[];
  subjects: { subject_id: number; mode: "counted" | "not_counted" | "hidden"; sort: number }[];
};

async function office() {
  const s = await getSession();
  return s?.staffRole === "office" ? s : null;
}
const pct = (v: string) => v.trim() === "" || (/^\d{1,3}(\.\d{1,2})?$/.test(v.trim()) && Number(v) <= 100);

function check(p: SchemeInput): string | null {
  if (!p.name.trim() || p.name.trim().length > 80) return "Give the scheme a name.";
  if (!pct(p.pass_percent) || !pct(p.overall_pass_percent)) return "Pass marks must be percentages between 0 and 100.";
  if (!p.terms.length) return "Add at least one term.";
  const termNos = new Set<number>();
  for (const t of p.terms) {
    if (!Number.isInteger(t.term) || t.term < 1 || t.term > 6 || termNos.has(t.term)) return "Each term needs its own number from 1 to 6.";
    termNos.add(t.term);
    if (!t.name.trim()) return "Each term needs a name.";
    if (!!t.starts_on !== !!t.ends_on) return `${t.name}: give both the first and last day, or neither.`;
    if (t.starts_on && t.ends_on < t.starts_on) return `${t.name}: the last day is before the first.`;
  }
  if (!p.components.length) return "Add at least one part (which exams count).";
  for (const c of p.components) {
    if (!termNos.has(c.term)) return `"${c.name || "A part"}" is in a term that is not listed.`;
    if (!c.name.trim() || !c.assessment_type_id) return "Each part needs a name and an exam type.";
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(c.out_of) || Number(c.out_of) <= 0) return `"${c.name}": "out of" must be a number above 0.`;
    if (c.rule === "best" && !/^\d{1,2}$/.test(c.best_n)) return `"${c.name}": say how many of the best tests count.`;
  }
  const mins = new Set<string>();
  for (const b of p.bands) {
    if (!pct(b.min_percent) || b.min_percent.trim() === "" || !b.grade.trim()) return "Each grade needs a grade and its lowest percent.";
    if (mins.has(b.min_percent)) return "Two grades start at the same percent.";
    mins.add(b.min_percent);
  }
  for (const a of p.areas) {
    if (!a.name.trim()) return "Each co-scholastic area needs a name.";
    if (a.grades.length < 2) return `${a.name}: give at least two grades, separated by commas.`;
  }
  return null;
}

export async function saveScheme(p: SchemeInput): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change report card schemes." };
  const bad = check(p);
  if (bad) return { ok: false, error: bad };
  const payload = {
    ...p,
    name: p.name.trim(), board: p.board.trim(),
    components: p.components.map((c) => ({ ...c, best_n: c.rule === "best" ? c.best_n : "", subject_ids: c.subject_ids.length ? c.subject_ids : null })),
    bands: p.bands.map((b) => ({ ...b, grade: b.grade.trim() })),
    areas: p.areas.map((a) => ({ ...a, name: a.name.trim(), grades: a.grades.map((g) => g.trim()).filter(Boolean) })),
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_report_scheme" as never, { p: payload } as never);
  if (error) {
    const m = error.message;
    if (m.includes("unique") || m.includes("duplicate")) return { ok: false, error: "A scheme with this name already exists." };
    if (m.includes("numeric exam type")) return { ok: false, error: "Choose exam types that have marks (not grade-only ones)." };
    return { ok: false, error: m.length < 160 ? m : "Could not save the scheme." };
  }
  revalidatePath("/dashboard/settings/report-cards");
  return { ok: true, id: data as unknown as number, message: "Saved." };
}

export async function deleteScheme(id: number): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change report card schemes." };
  const supabase = await createClient();
  const { count } = await supabase.from("report_card" as never).select("id", { count: "exact", head: true }).eq("scheme_id", id);
  if (count) return { ok: false, error: "Report cards were published with this scheme, so it is kept. Choose another scheme for its classes instead." };
  const { error } = await supabase.from("report_scheme" as never).delete().eq("id", id);
  if (error) return { ok: false, error: error.message.includes("violates") ? "A class still uses this scheme. Choose another scheme for it first." : "Could not delete." };
  revalidatePath("/dashboard/settings/report-cards");
  return { ok: true, message: "Deleted." };
}

// Which scheme a class uses this year; a section may use a different one.
export async function setAssignment(input: { classId: number; sectionId: number | null; schemeId: number | null }): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change report card schemes." };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No current year is set." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_report_assignment" as never,
    { p_year: year.id, p_class: input.classId, p_section: input.sectionId, p_scheme: input.schemeId } as never);
  if (error) return { ok: false, error: error.message.includes("another institution") ? "That section is not in this class." : "Could not save." };
  revalidatePath("/dashboard/settings/report-cards");
  return { ok: true, message: "Saved." };
}
