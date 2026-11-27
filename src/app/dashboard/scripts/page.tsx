import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession, getCurrentYear } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { ScriptsDesk, MyScripts, type PaperProgress, type MyScript } from "@/components/exams/scripts";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Coded answer scripts: the confidential section codes and decodes; evaluators mark by code.
export default async function ScriptsPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/scripts");
  if (denied) return denied;
  const [session, year, sp] = await Promise.all([getSession(), getCurrentYear(), searchParams]);
  if (!session) return null;
  const supabase = await createClient();
  const confidential = session.accessTypes.includes("confidential") || session.accessTypes.includes("exams_head");
  const { data: mine } = await supabase.rpc("my_scripts" as never);
  let progress: PaperProgress[] = []; let sessions: { id: number; name: string }[] = []; let sessionId = 0; let staff: { id: number; name: string }[] = [];
  if (confidential && year) {
    const { data: ses } = await supabase.from("exam_session" as never).select("id, name").eq("academic_year_id", year.id).order("created_at", { ascending: false });
    sessions = (ses ?? []) as unknown as { id: number; name: string }[];
    sessionId = Number(one(sp.session)) || sessions[0]?.id || 0;
    const [{ data: pr }, { data: st }] = await Promise.all([
      sessionId ? supabase.rpc("script_progress" as never, { p_session: sessionId } as never) : Promise.resolve({ data: [] }),
      supabase.from("staff").select("id, full_name").in("role", ["subject_teacher", "class_teacher"]).order("full_name").limit(1000),
    ]);
    progress = (pr ?? []) as unknown as PaperProgress[];
    staff = (st ?? []).map((x) => ({ id: x.id, name: x.full_name }));
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Coded scripts" description="Answer scripts carry a code instead of a name. Evaluators mark by code; the confidential section decodes the marks into the students' records." />
      {((mine ?? []) as unknown[]).length > 0 && <MyScripts rows={(mine ?? []) as unknown as MyScript[]} />}
      {confidential && <>
        <div className="flex flex-wrap gap-1.5">{sessions.map((s) => (
          <Link key={s.id} href={`?session=${s.id}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === sessionId ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{s.name}</Link>))}</div>
        <ScriptsDesk rows={progress} staff={staff} />
      </>}
      {!confidential && ((mine ?? []) as unknown[]).length === 0 && <p className="text-[13px] text-ink-500">No scripts are allotted to you.</p>}
    </div>
  );
}
