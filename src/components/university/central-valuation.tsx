"use client";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { centralValuation, universityEvaluators, centralAllot } from "@/app/dashboard/question-papers/actions";

type Row = Awaited<ReturnType<typeof centralValuation>>[number];
const dmy = (d: string) => d.split("-").reverse().join("/");

// Central valuation of a common exam: each campus codes its own scripts; here they are sent to evaluators from any
// campus (another campus's evaluator whenever one is chosen). Marks go back to the campuses, which decode them.
export function CentralValuation({ campusId, exams }: { campusId: number; exams: { id: number; name: string }[] }) {
  const [exam, setExam] = useState(exams[0]?.id ?? 0);
  const [rows, setRows] = useState<Row[]>([]);
  const [people, setPeople] = useState<{ staff_id: number; name: string; campus: string }[]>([]);
  const [pick, setPick] = useState<Record<number, number[]>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { void universityEvaluators(campusId).then(setPeople); }, [campusId]);
  useEffect(() => { if (exam) void centralValuation(exam).then(setRows); }, [exam]);
  if (!exams.length) return null;
  return (
    <div className="mt-6 rounded-sm border border-hair bg-white p-4 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-h3 text-ink-900">Central valuation</h2>
        <Select className="h-8 w-60" aria-label="Common exam for central valuation" value={exam} onChange={(e) => setExam(Number(e.target.value))}>{exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
      </div>
      <p className="mt-1 text-[12px] text-ink-500">Each campus codes its scripts after attendance. Send them here to evaluators of any campus; a script goes to someone from another campus whenever one is chosen.</p>
      {rows.length === 0 ? <p className="mt-2 text-ink-500">No papers in this exam.</p> : (
        <table className="mt-2 w-full"><tbody>{rows.map((r) => (
          <tr key={r.paper_id} className="border-t border-hair align-top">
            <td className="py-2 pr-2"><b>{r.subject}</b> <span className="text-ink-500">{r.class_name ?? ""} · {dmy(r.exam_date)}</span>
              <span className="block text-[12px] text-ink-500">{r.scripts} scripts from {r.campuses} campus{r.campuses === 1 ? "" : "es"} · {r.unassigned} not given out · {r.marked} marked · {r.decoded} decoded · {r.evaluators} evaluators</span></td>
            <td className="py-2 text-right">{r.unassigned > 0 && <span className="flex flex-wrap justify-end gap-1">
              <Select multiple className="h-20 w-64 text-[12px]" aria-label={`Evaluators for ${r.subject}`} value={(pick[r.paper_id] ?? []).map(String)}
                onChange={(e) => setPick({ ...pick, [r.paper_id]: [...e.target.selectedOptions].map((o) => Number(o.value)) })}>
                {people.map((p) => <option key={p.staff_id} value={p.staff_id}>{p.name} ({p.campus})</option>)}</Select>
              <Button size="sm" disabled={pending || !(pick[r.paper_id] ?? []).length} onClick={() => start(async () => { const x = await centralAllot(r.paper_id, pick[r.paper_id] ?? []); setMsg(x.ok ? x.message : x.error); setRows(await centralValuation(exam)); })}>Send scripts</Button></span>}</td>
          </tr>))}</tbody></table>)}
      {msg && <p className="mt-2 text-[12px] text-ink-700">{msg}</p>}
    </div>
  );
}
