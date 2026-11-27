import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope } from "@/lib/data/scope";
import { isExamsLead } from "@/lib/roles";
import { Returns, type Stats } from "@/components/courses/returns";

// Returns and the affiliating university: the counts NAAC and AISHE ask for, internal marks to send,
// and the university's results to bring in.
export default async function ReturnsPage() {
  const denied = await guardTab("/dashboard/returns");
  if (denied) return denied;
  const session = await getSession();
  if (!session) return null;
  const supabase = await createClient();
  const [{ data: stats }, { data: semData }, { data: aff }, scope, { data: mayImport }] = await Promise.all([
    supabase.rpc("institution_statistics" as never),
    supabase.from("semester" as never).select("id, kind, starts_on").in("kind", ["odd", "even"]).order("starts_on", { ascending: false }).limit(12),
    supabase.from("school").select("affiliation_board, board_school_code").eq("id", session.schoolId).maybeSingle(),
    getStaffScope(), supabase.rpc("can_publish_results" as never)]);
  // exam-cell staff without office rights: every section
  const { data: allSec } = scope.sections.length ? { data: [] } : await supabase.from("section").select("id, name, class:class_id(name)" as "id").order("id").limit(500);
  const sectionOpts = scope.sections.length ? scope.sections.map((s) => ({ id: s.id, label: `${s.class_name}-${s.name}` }))
    : ((allSec ?? []) as unknown as { id: number; name: string; class: { name: string } | null }[]).map((s) => ({ id: s.id, label: `${s.class?.name ?? ""}-${s.name}` }));
  const a = aff as { affiliation_board: string | null; board_school_code: string | null } | null;
  return (
    <div className="space-y-4">
      <PageHeader title="Returns and university" description={a?.affiliation_board ? `Affiliated to ${a.affiliation_board}${a.board_school_code ? `, college code ${a.board_school_code}` : ""}.` : "Counts for NAAC and AISHE, internal marks for the university, and the university's results."} />
      <Returns stats={stats as unknown as Stats | null} semesters={((semData ?? []) as unknown as { id: number; kind: string; starts_on: string }[]).map((s) => ({ id: s.id, label: `${s.kind === "odd" ? "Odd" : "Even"} ${s.starts_on.slice(0, 4)}` }))}
        sections={sectionOpts} canImport={!!mayImport && isExamsLead(session)} collegeCode={a?.board_school_code ?? ""} />
    </div>
  );
}
