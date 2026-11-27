"use client";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { downloadPdf, downloadPdfBook } from "@/lib/pdf";
import { gradeCardPdf } from "@/components/courses/grade-card-pdf";
import { publishResults, sectionGradeCards, holdResult } from "@/app/dashboard/results/actions";
import type { GradeCard } from "@/lib/data/results";

export type PreviewRow = { student_id: number; student_name: string; roll_no: number | null; course_id: number; course_code: string; course_name: string; credits: number;
  cia: number | null; cia_max: number | null; ese: number | null; ese_max: number | null; percent: number | null; grade: string | null; point: number | null; passed: boolean | null; status: string };

const n = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2));

export function ResultsDesk({ semesterId, sectionId, rows, published, canPublish, verifyBase }: {
  semesterId: number; sectionId: number; rows: PreviewRow[]; published: Record<number, { sgpa: number | null; cgpa: number | null; withheld_reason: string | null }>; canPublish: boolean; verifyBase: string;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [revise, setRevise] = useState<string | null>(null);
  const [hold, setHold] = useState<Record<number, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error ?? "" }); router.refresh();
  });
  const students = [...new Map(rows.map((r) => [r.student_id, r])).values()];
  const byStudent = (id: number) => rows.filter((r) => r.student_id === id);
  const sgpaOf = (id: number) => {
    const list = byStudent(id); if (list.some((r) => r.status === "incomplete" || r.status === "no_scheme")) return null;
    const cr = list.reduce((a, r) => a + Number(r.credits), 0); return cr ? list.reduce((a, r) => a + Number(r.credits) * Number(r.point ?? 0), 0) / cr : null;
  };
  const incomplete = students.filter((s) => byStudent(s.student_id).some((r) => r.status === "incomplete")).length;
  const noScheme = rows.some((r) => r.status === "no_scheme");
  return (
    <Card>
      <CardHeader title={`${students.length} students`} action={
        <div className="flex items-center gap-2">
          {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
          {canPublish && <Button size="sm" disabled={pending || students.length === 0} onClick={() => act(() => publishResults(semesterId, sectionId))}>Publish results</Button>}
          {canPublish && Object.keys(published).length > 0 && revise === null && <Button size="sm" variant="ghost" onClick={() => setRevise("")}>Revise published</Button>}
          <Button size="sm" variant="subtle" disabled={pending || Object.keys(published).length === 0} onClick={() => start(async () => {
            const r = await sectionGradeCards(semesterId, sectionId);
            if (!r.ok || !r.cards.length) { setMsg({ ok: false, text: r.ok ? "No published results yet." : r.error }); return; }
            await downloadPdfBook(r.cards.map((c) => gradeCardPdf(c, verifyBase + c.token)), "Grade cards");
          })}>Download grade cards</Button>
        </div>} />
      <CardBody className="p-0">
        {revise !== null && (
          <div className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-2 text-[13px]">
            <span>Revising recalculates published results from the current marks. The earlier results are kept on record.</span>
            <Input className="h-8 w-72 text-[13px]" aria-label="Reason for revising" placeholder="Reason, for example revaluation" value={revise} onChange={(e) => setRevise(e.target.value)} />
            <Button size="sm" disabled={pending || !revise.trim()} onClick={() => act(async () => { const r = await publishResults(semesterId, sectionId, revise); if (r.ok) setRevise(null); return r; })}>Revise</Button>
            <Button size="sm" variant="ghost" onClick={() => setRevise(null)}>Cancel</Button>
          </div>
        )}
        {noScheme && <p className="px-4 py-2 text-[13px] text-down">This programme has no evaluation scheme yet. The office chooses one in Settings, Evaluation and grading.</p>}
        {incomplete > 0 && <p className="px-4 py-2 text-[13px] text-ink-700">{incomplete} students still have marks missing (for example the end-semester exam); they are published once complete.</p>}
        {students.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No course registrations in this section for this semester.</p> : (
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Roll</th><th className="px-4 py-2 font-medium">Student</th><th className="px-4 py-2 font-medium">Courses</th><th className="px-4 py-2 text-right font-medium">SGPA</th><th className="px-4 py-2 text-right font-medium">Published</th><th /></tr></thead>
            <tbody>{students.map((s) => {
              const list = byStudent(s.student_id); const sg = sgpaOf(s.student_id); const pub = published[s.student_id];
              return (
                <Fragment key={s.student_id}>
                  <tr className="border-t border-hair">
                    <td className="px-4 py-1.5 tabular">{s.roll_no ?? "-"}</td><td className="px-4 py-1.5 font-medium">{s.student_name}</td>
                    <td className="px-4 py-1.5">{list.map((r) => <span key={r.course_id} className={`mr-2 ${r.status === "fail" ? "text-down" : r.status === "incomplete" ? "text-ink-500" : ""}`}>{r.course_code} {r.status === "incomplete" ? "…" : r.grade}</span>)}</td>
                    <td className="px-4 py-1.5 text-right tabular">{sg == null ? "-" : sg.toFixed(2)}</td>
                    <td className="px-4 py-1.5 text-right tabular">{pub ? (pub.withheld_reason ? <span className="text-down" title={pub.withheld_reason}>Held back</span> : <span className="text-up">SGPA {n(pub.sgpa)} · CGPA {n(pub.cgpa)}</span>) : <span className="text-ink-500">Not yet</span>}</td>
                    <td className="px-4 py-1.5 text-right"><Button size="sm" variant="ghost" onClick={() => setOpen(open === s.student_id ? null : s.student_id)}>{open === s.student_id ? "Hide" : "Marks"}</Button></td>
                  </tr>
                  {open === s.student_id && (
                    <tr><td colSpan={6} className="bg-[#fafafa] px-4 py-2">
                      <table className="w-full text-[12px]"><tbody>{list.map((r) => (
                        <tr key={r.course_id}><td className="py-0.5 pr-3 font-medium">{r.course_code}</td><td className="pr-3">{r.course_name}</td><td className="pr-3 tabular">{n(r.credits)} cr</td>
                          <td className="pr-3 tabular">CIA {n(r.cia)}/{n(r.cia_max)}</td><td className="pr-3 tabular">ESE {n(r.ese)}/{n(r.ese_max)}</td><td className="pr-3 tabular">{n(r.percent)}%</td>
                          <td className={r.status === "fail" || r.status === "absent" ? "text-down" : ""}>{r.status === "incomplete" ? "marks missing" : r.status === "absent" ? "absent in the end-semester exam" : `${r.grade} (${n(r.point)})`}</td></tr>))}</tbody></table>
                      {canPublish && pub && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                          {pub.withheld_reason ? (<>
                            <span className="text-down">Held back: {pub.withheld_reason}</span>
                            <Button size="sm" variant="subtle" disabled={pending} onClick={() => act(() => holdResult(semesterId, s.student_id, ""))}>Release</Button>
                          </>) : (<>
                            <Input className="h-8 w-64 text-[12px]" aria-label="Reason to hold back" placeholder="Reason to hold back, for example fees" value={hold[s.student_id] ?? ""} onChange={(e) => setHold({ ...hold, [s.student_id]: e.target.value })} />
                            <Button size="sm" variant="subtle" disabled={pending || !(hold[s.student_id] ?? "").trim()} onClick={() => act(() => holdResult(semesterId, s.student_id, hold[s.student_id]))}>Hold back</Button>
                          </>)}
                        </div>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

export function MyResults({ cards, verifyBase }: { cards: GradeCard[]; verifyBase: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {cards.map((c) => (
        <Card key={c.token}>
          <CardHeader title={`${c.student}: semester ${c.semester_no ?? ""}`} action={<Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { await downloadPdf(gradeCardPdf(c, verifyBase + c.token)); })}>Download grade card</Button>} />
          <CardBody className="space-y-2">
            <p className="text-[14px]"><b>SGPA {n(c.sgpa)}</b> · CGPA {n(c.cgpa)} · {n(c.credits_earned)} of {n(c.credits_registered)} credits earned{c.backlogs ? <span className="text-down"> · {c.backlogs} backlog{c.backlogs > 1 ? "s" : ""}</span> : null}</p>
            <table className="w-full text-[13px]"><tbody>{c.courses.map((x) => (
              <tr key={x.code} className="border-t border-hair first:border-t-0"><td className="py-1 pr-3 font-medium">{x.code}</td><td className="pr-3">{x.name}</td><td className="pr-3 tabular">{n(x.credits)} cr</td>
                <td className={`pr-3 ${x.passed ? "" : "text-down"}`}>{x.grade === "Ab" ? "Absent" : x.grade}</td><td className="tabular">{n(x.point)}</td></tr>))}</tbody></table>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
