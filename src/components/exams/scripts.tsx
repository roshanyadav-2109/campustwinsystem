"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { generateScripts, allotEvaluators, decodeScripts, saveScriptMarks } from "@/app/dashboard/exam-cell/actions";

export type PaperProgress = { paper_id: number; subject: string; exam_date: string; class_name: string; scripts: number; allotted: number; marked: number; decoded: number };
export type MyScript = { id: number; code: string; subject: string; exam_date: string; max_marks: number; marks: number | null; is_absent: boolean; status: string };
function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) router.refresh(); });
  return { msg, pending, run };
}
const M = ({ m }: { m: { ok: boolean; text: string } | null }) => m ? <span role={m.ok ? "status" : "alert"} className={`text-[12px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span> : null;

function PaperRow({ r, staff }: { r: PaperProgress; staff: { id: number; name: string }[] }) {
  const [ev, setEv] = useState<number[]>([]);
  const { msg, pending, run } = useAct();
  return (
    <tr className="border-t border-hair align-top">
      <td className="px-4 py-2"><b>{r.subject}</b> <span className="text-ink-500">{r.class_name} · {r.exam_date}</span></td>
      <td className="px-4 py-2 tabular">{r.scripts} coded · {r.allotted} allotted · {r.marked} marked · {r.decoded} decoded</td>
      <td className="px-4 py-2"><span className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => generateScripts(r.paper_id))}>Code scripts</Button>
        <Select className="h-8 text-[12px]" aria-label={`Evaluator for ${r.subject}`} value="" onChange={(e) => { const v = Number(e.target.value); if (v && !ev.includes(v)) setEv([...ev, v]); }}>
          <option value="">Add evaluator…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        {ev.length > 0 && <span className="text-[12px]">{ev.map((id) => staff.find((s) => s.id === id)?.name).join(", ")}</span>}
        <Button size="sm" variant="subtle" disabled={pending || !ev.length} onClick={() => run(() => allotEvaluators(r.paper_id, ev))}>Allot</Button>
        <Button size="sm" disabled={pending || !r.marked} onClick={() => run(() => decodeScripts(r.paper_id))}>Decode</Button>
        <M m={msg} /></span></td>
    </tr>
  );
}

export function ScriptsDesk({ rows, staff }: { rows: PaperProgress[]; staff: { id: number; name: string }[] }) {
  return (
    <Card>
      <CardHeader title="Papers" />
      <CardBody className="p-0">{rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No papers in this exam yet.</p> : (
        <table className="w-full text-[13px]"><tbody>{rows.map((r) => <PaperRow key={r.paper_id} r={r} staff={staff} />)}</tbody></table>)}
      </CardBody>
    </Card>
  );
}

export function MyScripts({ rows }: { rows: MyScript[] }) {
  const [vals, setVals] = useState<Record<number, { marks: string; absent: boolean }>>(Object.fromEntries(rows.map((r) => [r.id, { marks: r.marks == null ? "" : String(Number(r.marks)), absent: r.is_absent }])));
  const { msg, pending, run } = useAct();
  return (
    <Card>
      <CardHeader title={`Scripts for you to mark (${rows.length})`} action={<span className="flex items-center gap-2"><M m={msg} /><Button size="sm" disabled={pending} onClick={() => run(() => saveScriptMarks(rows.map((r) => ({ id: r.id, ...vals[r.id] }))))}>Save marks</Button></span>} />
      <CardBody className="p-0">
        <table className="w-full text-[13px]"><thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Code</th><th className="px-4 py-2 font-medium">Paper</th><th className="px-4 py-2 font-medium">Marks</th></tr></thead>
          <tbody>{rows.map((r) => { const v = vals[r.id] ?? { marks: "", absent: false }; return (
            <tr key={r.id} className="border-t border-hair"><td className="px-4 py-1.5 font-mono">{r.code}</td><td className="px-4 py-1.5">{r.subject} <span className="text-ink-500">{r.exam_date}</span></td>
              <td className="px-4 py-1.5"><span className="inline-flex items-center gap-2"><Input className="h-8 w-20 text-right text-[13px]" aria-label={`Marks for script ${r.code}`} disabled={v.absent} value={v.marks} onChange={(e) => setVals({ ...vals, [r.id]: { ...v, marks: e.target.value } })} />
                <span className="text-ink-500">/ {Number(r.max_marks)}</span><label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={v.absent} onChange={(e) => setVals({ ...vals, [r.id]: { ...v, absent: e.target.checked } })} />Absent</label></span></td></tr>); })}</tbody></table>
      </CardBody>
    </Card>
  );
}
