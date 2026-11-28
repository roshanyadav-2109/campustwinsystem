import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession, getCurrentYear } from "@/lib/session";
import { isExams, isExamsLead } from "@/lib/roles";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { SeatingDesk, type RoomRow, type Accommodation } from "@/components/exams/seating";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Exam rooms, seating plans and invigilation duties.
export default async function SeatingPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/seating");
  if (denied) return denied;
  const [session, year, sp] = await Promise.all([getSession(), getCurrentYear(), searchParams]);
  if (!session || !isExams(session) || !year) return <EmptyState art="no-results" title="For the exam cell" />;
  const supabase = await createClient();
  const [{ data: rooms }, { data: ses }] = await Promise.all([
    supabase.from("exam_room" as never).select("id, name, capacity, active").order("sort").order("name"),
    supabase.from("exam_session" as never).select("id, name").eq("academic_year_id", year.id).order("created_at", { ascending: false }),
  ]);
  const sessions = (ses ?? []) as unknown as { id: number; name: string }[];
  const sessionId = Number(one(sp.session)) || sessions[0]?.id || 0;
  const { data: duties } = sessionId ? await supabase.from("exam_duty" as never).select("id, exam_date, starts_at, room:room_id(name), staff:staff_id(id, full_name)").eq("session_id", sessionId).order("exam_date").order("starts_at").limit(2000) : { data: [] };
  const [{ data: teachers }, { data: acc }, { data: rates }] = await Promise.all([
    supabase.from("staff").select("id, full_name").in("role", ["subject_teacher", "class_teacher"]).order("full_name"),
    supabase.from("exam_accommodation" as never).select("id, session_id, scribe, scribe_name, extra_minutes, note, student:student_id(full_name, admission_no)").or(sessionId ? `session_id.is.null,session_id.eq.${sessionId}` : "session_id.is.null").limit(500),
    supabase.from("exam_rate" as never).select("kind, amount"),
  ]);
  const rr = (rates ?? []) as unknown as { kind: string; amount: number }[];
  const { count: seated } = sessionId ? await supabase.from("exam_seat" as never).select("id", { count: "exact", head: true }).eq("session_id", sessionId) : { count: 0 };
  return (
    <div className="space-y-4">
      <PageHeader title="Seating and invigilation" description="Exam rooms, who sits where for each paper, and who invigilates. Plans are made per exam; re-plan after adding papers or candidates." />
      <div className="flex flex-wrap gap-1.5">{sessions.map((s) => (
        <Link key={s.id} href={`?session=${s.id}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === sessionId ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{s.name}</Link>))}</div>
      <SeatingDesk rooms={(rooms ?? []) as unknown as RoomRow[]} sessionId={sessionId} sessionName={sessions.find((s) => s.id === sessionId)?.name ?? ""} seated={seated ?? 0} school={session.school.name}
        duties={(duties ?? []) as unknown as { id: number; exam_date: string; starts_at: string; room: { name: string }; staff: { id: number; full_name: string } }[]}
        teachers={((teachers ?? []) as { id: number; full_name: string }[]).map((t) => ({ id: t.id, name: t.full_name }))}
        accommodations={(acc ?? []) as unknown as Accommodation[]} rates={{ duty: Number(rr.find((x) => x.kind === "duty")?.amount ?? 0), script: Number(rr.find((x) => x.kind === "script")?.amount ?? 0) }}
        canSetRates={isExamsLead(session)} />
    </div>
  );
}
