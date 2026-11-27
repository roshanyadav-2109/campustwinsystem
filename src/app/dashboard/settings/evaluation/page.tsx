import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { isExamsLead } from "@/lib/roles";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { EvaluationAdmin, type SchemeRow } from "@/components/settings/evaluation";

// Settings → Evaluation and grading (colleges and universities).
export default async function EvaluationPage() {
  const denied = await guardTab("/dashboard/settings/evaluation");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const [s, c, g, p, r] = await Promise.all([
    supabase.from("eval_scheme" as never).select("id, name, pass_percent, ese_min_percent, grace_per_course, grace_total, supp_max_point").order("name"),
    supabase.from("eval_component" as never).select("id, scheme_id, part, name, rule, best_n, weight").order("part"),
    supabase.from("eval_grade" as never).select("scheme_id, min_percent, grade, point").order("min_percent", { ascending: false }),
    supabase.from("programme" as never).select("id, code, name, eval_scheme_id").order("code"),
    supabase.from("school").select("reval_fee, retotal_fee, reval_window_days, cgpa_pct_multiplier, cgpa_pct_offset" as "id").eq("id", session?.schoolId ?? 0).maybeSingle(),
  ]);
  const comps = (c.data ?? []) as unknown as { id: number; scheme_id: number; part: string; name: string; rule: string; best_n: number | null; weight: number }[];
  const grades = (g.data ?? []) as unknown as { scheme_id: number; min_percent: number; grade: string; point: number }[];
  const schemes: SchemeRow[] = ((s.data ?? []) as unknown as { id: number; name: string; pass_percent: number; ese_min_percent: number | null; grace_per_course: number | null; grace_total: number | null; supp_max_point: number | null }[])
    .map((x) => ({ ...x, components: comps.filter((k) => k.scheme_id === x.id), grades: grades.filter((k) => k.scheme_id === x.id) }));
  return (
    <div className="space-y-4">
      <PageHeader title="Evaluation and grading" description="How internal assessment (CIA) and the end-semester exam (ESE) make a course result, the pass marks, and the grade points used for SGPA and CGPA." />
      <EvaluationAdmin schemes={schemes} programmes={(p.data ?? []) as unknown as { id: number; code: string; name: string; eval_scheme_id: number | null }[]} canEdit={isExamsLead(session)} rules={r.data as unknown as { reval_fee: number | null; retotal_fee: number | null; reval_window_days: number; cgpa_pct_multiplier: number | null; cgpa_pct_offset: number } | null} />
    </div>
  );
}
