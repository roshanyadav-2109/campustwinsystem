"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { decideIncident, type Penalty } from "@/app/dashboard/exam-cell/actions";

export type Incident = { id: number; exam_date: string; description: string; status: string; penalty: string | null; student: { full_name: string; admission_no: string }; session: { name: string } };

export function Incidents({ rows, canDecide }: { rows: Incident[]; canDecide: boolean }) {
  const [note, setNote] = useState<Record<number, string>>({});
  const [pen, setPen] = useState<Record<number, Penalty>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!rows.length) return null;
  return (
    <section className="rounded-md border border-hair bg-white p-4 text-[13px]">
      <div className="text-[14px] font-semibold">Malpractice reports ({rows.filter((r) => r.status === "open").length} open)</div>
      <ul className="mt-2 space-y-2">{rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2"><b>{r.student.full_name}</b> <span className="text-ink-500">{r.student.admission_no} · {r.session.name} · {r.exam_date}</span>: {r.description}
          {r.status !== "open" ? <span className="text-ink-700">({r.status}{r.penalty ? `: ${r.penalty.replace("_", " ")}` : ""})</span> : canDecide ? <>
            <Input className="h-8 w-48 text-[12px]" aria-label={`Decision for ${r.student.full_name}`} placeholder="Decision" value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
            <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const x = await decideIncident(r.id, "cleared", note[r.id] ?? ""); setMsg(x.ok ? x.message ?? "" : x.error); router.refresh(); })}>Clear</Button>
            <select className="h-8 rounded-sm border border-hair text-[12px]" aria-label={`Penalty for ${r.student.full_name}`} value={pen[r.id] ?? "warning"} onChange={(e) => setPen({ ...pen, [r.id]: e.target.value as Penalty })}>
              <option value="warning">Warning</option><option value="cancel_paper">Cancel this paper</option><option value="cancel_all">Cancel all papers of this exam</option><option value="debar">Debar (result withheld)</option></select>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const x = await decideIncident(r.id, "penalised", note[r.id] ?? "", pen[r.id] ?? "warning"); setMsg(x.ok ? x.message ?? "" : x.error); router.refresh(); })}>Record penalty</Button>
          </> : <span className="text-down">open, result held</span>}</li>))}</ul>
      {msg && <p className="mt-1 text-[12px] text-ink-700">{msg}</p>}
    </section>
  );
}
