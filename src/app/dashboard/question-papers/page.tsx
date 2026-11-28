import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession, getCurrentYear } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { MyQuestionPapers, SessionQuestionPapers, type MyPaper, type SessionPaper } from "@/components/exams/question-papers";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Question papers: setters and moderators per paper; private upload; release to the exam cell near the start.
export default async function QuestionPapersPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/question-papers");
  if (denied) return denied;
  const [session, year, sp] = await Promise.all([getSession(), getCurrentYear(), searchParams]);
  if (!session) return null;
  const supabase = await createClient();
  const runs = session.accessTypes.includes("confidential") || session.accessTypes.includes("exams_head") || session.isAdminScope || session.isUniversityAdmin;
  const { data: mine } = await supabase.rpc("my_question_papers" as never);
  let sessions: { id: number; name: string }[] = []; let sessionId = 0; let rows: SessionPaper[] = []; let staff: { id: number; name: string }[] = [];
  if (runs && year) {
    const { data: ses } = await supabase.from("exam_session" as never).select("id, name").eq("academic_year_id", year.id).order("created_at", { ascending: false });
    sessions = (ses ?? []) as unknown as { id: number; name: string }[];
    sessionId = Number(one(sp.session)) || sessions[0]?.id || 0;
    const [{ data: qp }, { data: st }] = await Promise.all([
      sessionId ? supabase.rpc("session_question_papers" as never, { p_session: sessionId } as never) : Promise.resolve({ data: [] }),
      supabase.from("staff").select("id, full_name").in("role", ["subject_teacher", "class_teacher", "principal"]).order("full_name").limit(1000),
    ]);
    rows = (qp ?? []) as unknown as SessionPaper[];
    staff = (st ?? []).map((x) => ({ id: x.id, name: x.full_name }));
    // central administration chooses setters and moderators from every campus
    if (session.isUniversityAdmin) {
      const { data: us } = await supabase.rpc("university_evaluators" as never, { p_school: session.schoolId } as never);
      staff = ((us ?? []) as unknown as { staff_id: number; name: string; campus: string }[]).map((x) => ({ id: x.staff_id, name: `${x.name} (${x.campus})` }));
    }
  }
  const my = (mine ?? []) as unknown as MyPaper[];
  return (
    <div className="space-y-4">
      <PageHeader title="Question papers" description="Name a setter and a moderator for each paper. The setter uploads the paper privately; the moderator approves it. The exam cell opens it only shortly before the paper starts." />
      {my.length > 0 && <MyQuestionPapers rows={my} />}
      {runs && <>
        <div className="flex flex-wrap gap-1.5">{sessions.map((s) => (
          <Link key={s.id} href={`?session=${s.id}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === sessionId ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{s.name}</Link>))}</div>
        {sessionId ? <SessionQuestionPapers rows={rows} staff={staff} /> : <p className="text-[13px] text-ink-500">No exams this year yet.</p>}
      </>}
      {!runs && my.length === 0 && <p className="text-[13px] text-ink-500">You have no question papers to set or moderate.</p>}
    </div>
  );
}
