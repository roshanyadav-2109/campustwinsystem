import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { getCurrentYear } from "@/lib/session";
import { ReportSchemesAdmin, type SchemeView, type Option, type ClassOpt } from "@/components/settings/report-schemes";

type Row = Record<string, unknown>;

// Settings → Report cards (office): the school's own report-card schemes and
// which class or section uses which this year.
export default async function ReportCardSettingsPage() {
  const denied = await guardTab("/dashboard/settings/report-cards");
  if (denied) return denied;
  const year = await getCurrentYear();
  if (!year) return <EmptyState art="error" title="No current school year is set" />;
  const supabase = await createClient();
  const q = (t: string, cols: string) => supabase.from(t as never).select(cols);
  const [schemes, terms, comps, bands, areas, subjs, assign, types, subjects, classes, sections] = await Promise.all([
    q("report_scheme", "id, name, board, pass_percent, overall_pass_percent, show_marks, show_grades, show_percent, final_label").order("name"),
    q("report_scheme_term", "scheme_id, term, name, starts_on, ends_on").order("term"),
    q("report_scheme_component", "id, scheme_id, term, name, assessment_type_id, rule, best_n, out_of, sort, subject_ids").order("sort"),
    q("report_grade_band", "scheme_id, min_percent, grade, grade_point, remark").order("min_percent", { ascending: false }),
    q("report_coscholastic_area", "id, scheme_id, name, grades, sort").order("sort"),
    q("report_scheme_subject", "scheme_id, subject_id, mode, sort").order("sort"),
    q("report_scheme_assignment", "class_id, section_id, scheme_id").eq("academic_year_id", year.id),
    supabase.from("assessment_type").select("id, name, is_numeric").order("name"),
    supabase.from("subject").select("id, name").order("name"),
    supabase.from("class").select("id, name, level").order("level"),
    supabase.from("section").select("id, class_id, name").order("name"),
  ]);
  const by = (res: { data: unknown }, id: number) => ((res.data ?? []) as Row[]).filter((r) => r.scheme_id === id);
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const views: SchemeView[] = ((schemes.data ?? []) as Row[]).map((s) => {
    const id = s.id as number;
    return {
      id, name: str(s.name), board: str(s.board), pass_percent: str(s.pass_percent), overall_pass_percent: str(s.overall_pass_percent),
      show_marks: !!s.show_marks, show_grades: !!s.show_grades, show_percent: !!s.show_percent, final_label: str(s.final_label),
      terms: by(terms, id).map((t) => ({ term: t.term as number, name: str(t.name), starts_on: str(t.starts_on), ends_on: str(t.ends_on) })),
      components: by(comps, id).map((c) => ({ id: c.id as number, term: c.term as number, name: str(c.name), assessment_type_id: c.assessment_type_id as number,
        rule: c.rule as "sum" | "average" | "best", best_n: str(c.best_n), out_of: str(Number(c.out_of)), sort: c.sort as number, subject_ids: (c.subject_ids as number[] | null) ?? [] })),
      bands: by(bands, id).map((b) => ({ min_percent: str(Number(b.min_percent)), grade: str(b.grade), grade_point: b.grade_point == null ? "" : str(Number(b.grade_point)), remark: str(b.remark) })),
      areas: by(areas, id).map((a) => ({ id: a.id as number, name: str(a.name), grades: (a.grades as string[]) ?? [], sort: a.sort as number })),
      subjects: by(subjs, id).map((x) => ({ subject_id: x.subject_id as number, mode: x.mode as "counted" | "not_counted" | "hidden", sort: x.sort as number })),
    };
  });
  const examTypes: Option[] = (types.data ?? []).filter((t) => t.is_numeric).map((t) => ({ id: t.id, name: t.name }));
  const subjectOpts: Option[] = (subjects.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  const assignments = (assign.data ?? []) as unknown as { class_id: number; section_id: number | null; scheme_id: number }[];
  const classOpts: ClassOpt[] = (classes.data ?? []).map((c) => ({
    id: c.id, name: c.name,
    schemeId: assignments.find((a) => a.class_id === c.id && a.section_id == null)?.scheme_id ?? null,
    sections: (sections.data ?? []).filter((s) => s.class_id === c.id).map((s) => ({
      id: s.id, name: s.name, schemeId: assignments.find((a) => a.section_id === s.id)?.scheme_id ?? null,
    })),
  }));

  return (
    <div className="space-y-5">
      <PageHeader title="Report cards" description={`Your own report card schemes, one per board or pattern you follow, and which class uses which in ${year.name}.`} />
      <ReportSchemesAdmin schemes={views} examTypes={examTypes} subjects={subjectOpts} classes={classOpts} />
    </div>
  );
}
