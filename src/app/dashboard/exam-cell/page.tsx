import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { Incidents, type Incident } from "@/components/exams/incidents";

type Overview = {
  sessions: { id: number; name: string; kind: string; published: boolean; papers: number; tickets: number; candidates: number; marks_missing: number; seated: number }[];
  semesters: { id: number; kind: string; starts_on: string; registered: number; published: number }[];
  reval_waiting: number; reval_fee_pending: number; scripts_unmarked: number; scripts_to_decode: number; duties_today: number; can_publish: boolean;
};

// The exam department's own home: sessions and their stage, results by semester, and what needs doing.
export default async function ExamCellPage() {
  const denied = await guardTab("/dashboard/exam-cell");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const { data } = await supabase.rpc("exam_cell_overview" as never);
  const o = data as unknown as Overview | null;
  const { data: inc } = await supabase.from("exam_incident" as never).select("id, exam_date, description, status, student:student_id(full_name, admission_no), session:session_id(name)").order("created_at", { ascending: false }).limit(50);
  if (!session || !o) return (<div><PageHeader title="Exam cell" /><EmptyState art="no-results" title="For the exam cell" /></div>);
  const alerts = [
    o.reval_waiting ? [`${o.reval_waiting} revaluation request${o.reval_waiting > 1 ? "s" : ""} waiting${o.reval_fee_pending ? ` (${o.reval_fee_pending} with the fee unpaid)` : ""}`, "/dashboard/revaluation"] : null,
    o.scripts_unmarked ? [`${o.scripts_unmarked} coded scripts not yet marked`, "/dashboard/scripts"] : null,
    o.scripts_to_decode ? [`${o.scripts_to_decode} marked scripts to decode`, "/dashboard/scripts"] : null,
    ...o.sessions.filter((s) => s.kind !== "regular" && s.marks_missing > 0).map((s) => [`${s.name}: ${s.marks_missing} candidates without marks`, `/dashboard/supplementary?session=${s.id}`]),
    ...o.sessions.filter((s) => s.published && s.papers === 0).map((s) => [`${s.name} is published but has no papers`, `/dashboard/exam-timetable?exam=${s.id}`]),
  ].filter(Boolean) as [string, string][];
  return (
    <div className="space-y-4">
      <PageHeader title="Exam cell" description="Exams this year and their stage, results by semester, and what is waiting." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Revaluations waiting", o.reval_waiting, "/dashboard/revaluation"], ["Scripts to mark", o.scripts_unmarked, "/dashboard/scripts"], ["Scripts to decode", o.scripts_to_decode, "/dashboard/scripts"], ["Invigilation duties today", o.duties_today, "/dashboard/seating"]].map(([k, v, href]) => (
          <Link key={k as string} href={href as string} className="rounded-sm border border-hair bg-white p-3 hover:bg-panel"><div className="text-[22px] font-semibold tabular">{v as number}</div><div className="text-[12px] text-ink-700">{k}</div></Link>))}
      </div>
      <Incidents rows={(inc ?? []) as unknown as Incident[]} canDecide={!!o.can_publish} />
      {alerts.length > 0 && <Card><CardHeader title="Needs attention" /><CardBody className="space-y-1 text-[13px]">{alerts.map(([t, href]) => <p key={t}><Link href={href} className="text-[#0F6CBD] hover:underline">{t}</Link></p>)}</CardBody></Card>}
      <Card>
        <CardHeader title="Exams this year" />
        <CardBody className="p-0">{o.sessions.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No exams yet.</p> : (
          <table className="w-full text-[13px]"><thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Exam</th><th className="px-4 py-2 font-medium">Kind</th><th className="px-4 py-2 text-right font-medium">Papers</th><th className="px-4 py-2 text-right font-medium">Hall tickets</th><th className="px-4 py-2 text-right font-medium">Seated</th><th className="px-4 py-2 font-medium">Stage</th></tr></thead>
            <tbody>{o.sessions.map((s) => {
              const stage = !s.papers ? "Setting papers" : !s.published ? "Draft" : !s.tickets ? "Published, hall tickets not issued" : !s.seated ? "Hall tickets issued, seating not planned" : s.kind !== "regular" && s.marks_missing ? "Marks being entered" : "Ready";
              return <tr key={s.id} className="border-t border-hair"><td className="px-4 py-1.5 font-medium"><Link href={s.kind === "regular" ? `/dashboard/exam-timetable?exam=${s.id}` : `/dashboard/supplementary?session=${s.id}`} className="hover:underline">{s.name}</Link></td>
                <td className="px-4 py-1.5 capitalize">{s.kind}</td><td className="px-4 py-1.5 text-right tabular">{s.papers}</td><td className="px-4 py-1.5 text-right tabular">{s.tickets}</td><td className="px-4 py-1.5 text-right tabular">{s.seated}</td><td className="px-4 py-1.5">{stage}</td></tr>;
            })}</tbody></table>)}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Results by semester" />
        <CardBody className="p-0"><table className="w-full text-[13px]"><tbody>{o.semesters.map((m) => (
          <tr key={m.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5 font-medium">{m.kind === "odd" ? "Odd" : "Even"} semester {m.starts_on.slice(0, 4)}</td>
            <td className="px-4 py-1.5 tabular">{m.published} of {m.registered} students published</td>
            <td className="px-4 py-1.5 text-right"><Link href={`/dashboard/results?semester=${m.id}`} className="text-[#0F6CBD] hover:underline">Results</Link></td></tr>))}</tbody></table>
          {!o.can_publish && <p className="px-4 pb-3 text-[12px] text-ink-500">Results are published by the Controller of Examinations.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
