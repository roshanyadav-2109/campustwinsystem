import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { isExams } from "@/lib/roles";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { NewSupplementary, SupplementaryDesk, type SuppRow } from "@/components/courses/supplementary";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Backlogs and supplementary exams (colleges and universities): the exam cell.
export default async function SupplementaryPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/supplementary");
  if (denied) return denied;
  const [session, sp] = await Promise.all([getSession(), searchParams]);
  if (!session || !isExams(session)) return <EmptyState art="no-results" title="For the exam cell" />;
  const supabase = await createClient();
  const [{ data: sessData }, { data: semData }, { data: pub }] = await Promise.all([
    supabase.from("exam_session" as never).select("id, name, for_semester_id, fee_per_course, registration_closes, created_at").eq("kind", "supplementary").order("created_at", { ascending: false }).limit(30),
    supabase.from("semester" as never).select("id, kind, starts_on").in("kind", ["odd", "even"]).order("starts_on", { ascending: false }).limit(12),
    supabase.rpc("can_publish_results" as never),
  ]);
  const sessions = (sessData ?? []) as unknown as { id: number; name: string; for_semester_id: number; fee_per_course: number | null; registration_closes: string | null }[];
  // only semesters with published results can have backlogs
  const semIds = ((semData ?? []) as unknown as { id: number }[]).map((x) => x.id);
  const withResults = new Set<number>();
  await Promise.all(semIds.map(async (id) => {
    const { count } = await supabase.from("semester_result" as never).select("id", { count: "exact", head: true }).eq("semester_id", id);
    if (count) withResults.add(id);
  }));
  const allSems = ((semData ?? []) as unknown as { id: number; kind: string; starts_on: string }[]).map((s) => ({ id: s.id, label: `${s.kind === "odd" ? "Odd" : "Even"} semester ${s.starts_on.slice(0, 4)}` }));
  const sems = allSems.filter((s) => withResults.has(s.id));
  const sessionId = Number(one(sp.session)) || sessions[0]?.id || 0;
  const cur = sessions.find((s) => s.id === sessionId) ?? null;
  let rows: SuppRow[] = [];
  let backlogCount = 0;
  if (cur) {
    const [{ data: regs }, { data: bl }] = await Promise.all([
      supabase.from("supp_registration" as never).select("id, attempt, cia, cia_max, ese_marks, ese_max, is_absent, status, student:student_id(full_name, admission_no), course:course_id(code, name), result:result_id(grade, passed)")
        .eq("session_id", cur.id).order("course_id").limit(5000),
      supabase.rpc("semester_backlogs" as never, { p_semester: cur.for_semester_id } as never),
    ]);
    rows = (regs ?? []) as unknown as SuppRow[];
    backlogCount = ((bl ?? []) as unknown[]).length;
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Supplementary exams" description="Backlogs (courses not yet passed), supplementary exams for them, marks and results. Internal marks carry forward; the original grade card stays as published." />
      <div className="flex flex-wrap gap-1.5">{sessions.map((s) => (
        <Link key={s.id} href={`?session=${s.id}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === sessionId ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{s.name}</Link>))}
      </div>
      {sems.length ? <NewSupplementary semesters={sems} /> : <p className="text-[13px] text-ink-500">Supplementary exams can be set up once results for a semester are published.</p>}
      {cur ? (
        <SupplementaryDesk key={cur.id} sessionId={cur.id} name={cur.name} fee={cur.fee_per_course} rows={rows} openBacklogs={backlogCount} canPublish={pub === true}
          semester={allSems.find((s) => s.id === cur.for_semester_id)?.label ?? ""} />
      ) : <EmptyState art="nothing-yet" title="No supplementary exam yet" hint="Create one for the semester whose backlogs are to be cleared." />}
    </div>
  );
}
