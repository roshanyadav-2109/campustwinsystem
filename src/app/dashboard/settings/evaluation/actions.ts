"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { isExamsLead } from "@/lib/roles";

type R = { ok: true; message?: string } | { ok: false; error: string };
const PATH = "/dashboard/settings/evaluation";
const office = async () => isExamsLead(await getSession());

// The usual pattern: internal tests + mid-semester = 40, end-semester = 60, UGC 10-point grades.
export async function createStandardScheme(): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change evaluation." };
  const supabase = await createClient();
  const { data: types } = await supabase.from("assessment_type").select("id, code, is_numeric");
  const t = (code: string) => (types ?? []).find((x) => x.code === code && x.is_numeric)?.id;
  if (!t("periodic_test") || !t("half_yearly") || !t("annual")) return { ok: false, error: "Exam types for internal tests, mid-semester and end-semester are needed first (Settings, Exams)." };
  const { data: sch, error } = await supabase.from("eval_scheme" as never).insert({ name: "Standard (CIA 40 + ESE 60)", ese_min_percent: 40, pass_percent: 40 } as never).select("id").single();
  if (error || !sch) return { ok: false, error: error?.message.includes("duplicate") ? "This scheme already exists." : "Could not create it." };
  const id = (sch as { id: number }).id;
  await supabase.from("eval_component" as never).insert([
    { scheme_id: id, part: "cia", name: "Internal tests", assessment_type_id: t("periodic_test"), rule: "average", weight: 20 },
    { scheme_id: id, part: "cia", name: "Mid-semester exam", assessment_type_id: t("half_yearly"), rule: "sum", weight: 20 },
    { scheme_id: id, part: "ese", name: "End-semester exam", assessment_type_id: t("annual"), rule: "sum", weight: 60 },
  ] as never);
  await supabase.from("eval_grade" as never).insert([[90, "O", 10], [80, "A+", 9], [70, "A", 8], [60, "B+", 7], [50, "B", 6], [45, "C", 5], [40, "P", 4], [0, "F", 0]]
    .map(([m, g, p]) => ({ scheme_id: id, min_percent: m, grade: g, point: p })) as never);
  revalidatePath(PATH);
  return { ok: true, message: "Scheme created. Choose it for your programmes below." };
}

export async function saveScheme(id: number, input: { passPercent: string; eseMin: string; weights: Record<number, string> }): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change evaluation." };
  const pct = (v: string) => v.trim() === "" || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100);
  if (!pct(input.passPercent) || !input.passPercent.trim() || !pct(input.eseMin)) return { ok: false, error: "Pass marks are percentages." };
  const supabase = await createClient();
  const { data: low } = await supabase.from("eval_grade" as never).select("point").eq("scheme_id", id).lte("min_percent", Number(input.passPercent)).order("min_percent", { ascending: false }).limit(1);
  const lowRows = (low ?? []) as unknown as { point: number }[];
  if (lowRows.length && Number(lowRows[0].point) <= 0)
    return { ok: false, error: "At this pass mark a passing student would get 0 grade points. Raise the pass mark to a grade that carries points." };
  const { error } = await supabase.from("eval_scheme" as never).update({ pass_percent: Number(input.passPercent), ese_min_percent: input.eseMin.trim() ? Number(input.eseMin) : null } as never).eq("id", id);
  if (error) return { ok: false, error: "Could not save." };
  for (const [cid, w] of Object.entries(input.weights)) {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(w) || Number(w) <= 0) return { ok: false, error: "Weights must be numbers above 0." };
    await supabase.from("eval_component" as never).update({ weight: Number(w) } as never).eq("id", Number(cid)).eq("scheme_id", id);
  }
  const { error: chk } = await supabase.rpc("eval_scale_check" as never, { p_scheme: id } as never);
  if (chk) return { ok: false, error: "The grade at the pass mark must carry grade points. Change the pass mark or the grade scale." };
  revalidatePath(PATH);
  return { ok: true, message: "Saved. Results already published stay as they were." };
}

export async function assignScheme(programmeId: number, schemeId: number | null): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change evaluation." };
  const supabase = await createClient();
  const { error } = await supabase.from("programme" as never).update({ eval_scheme_id: schemeId } as never).eq("id", programmeId);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}
