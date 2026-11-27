"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { decideRevaluation } from "@/app/dashboard/results/actions";

export type RevalRow = { id: number; kind: string; status: string; old_ese: number | null; new_ese: number | null; old_grade: string | null; new_grade: string | null; note: string | null; created_at: string;
  invoice: { status: string; amount: number; paid_amount: number } | null; student: { full_name: string; admission_no: string };
  result: { ese_max: number | null; attempt: number; course: { code: string; name: string } } };
const n = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2));

function Row({ r, canDecide }: { r: RevalRow; canDecide: boolean }) {
  const [ese, setEse] = useState(r.old_ese == null ? "" : String(Number(r.old_ese)));
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const unpaid = r.invoice && (r.invoice.status === "due" || r.invoice.status === "part");
  return (
    <tr className="border-t border-hair align-top">
      <td className="px-4 py-2">{r.student.full_name} <span className="text-ink-500">{r.student.admission_no}</span></td>
      <td className="px-4 py-2"><b>{r.result.course.code}</b> {r.result.course.name}{r.result.attempt > 1 ? <span className="text-ink-500"> (attempt {r.result.attempt})</span> : null}</td>
      <td className="px-4 py-2 capitalize">{r.kind}</td>
      <td className="px-4 py-2 tabular">{n(r.old_ese)}/{n(r.result.ese_max)} · {r.old_grade}</td>
      <td className="px-4 py-2">
        {r.status !== "requested" ? (
          <span className={r.status === "revised" ? "text-up" : "text-ink-700"}>{r.status === "revised" ? `Revised to ${n(r.new_ese)} · ${r.new_grade}` : r.status.replace("_", " ")}{r.note ? <span className="block text-[12px] text-ink-500">{r.note}</span> : null}</span>
        ) : unpaid ? <span className="text-ink-500">Fee not paid yet</span> : canDecide ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Input className="h-8 w-20 text-right text-[13px]" aria-label={`New end-semester marks for ${r.student.full_name}, ${r.result.course.code}`} value={ese} onChange={(e) => setEse(e.target.value)} />
            <span className="text-ink-500">/ {n(r.result.ese_max)}</span>
            <Input className="h-8 w-44 text-[12px]" aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" disabled={pending} onClick={() => start(async () => { const x = await decideRevaluation(r.id, ese, note); setMsg(x.ok ? { ok: true, text: x.message ?? "" } : { ok: false, text: x.error }); if (x.ok) router.refresh(); })}>Save</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const x = await decideRevaluation(r.id, "", note || "No change"); setMsg(x.ok ? { ok: true, text: x.message ?? "" } : { ok: false, text: x.error }); if (x.ok) router.refresh(); })}>No change</Button>
          </span>
        ) : <span className="text-ink-500">Waiting for the Controller of Examinations</span>}
        {msg && <span role={msg.ok ? "status" : "alert"} className={`block text-[12px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
      </td>
    </tr>
  );
}

export function RevaluationDesk({ rows, canDecide }: { rows: RevalRow[]; canDecide: boolean }) {
  const waiting = rows.filter((r) => r.status === "requested");
  return (
    <Card>
      <CardHeader title={`Waiting (${waiting.length}) · all requests (${rows.length})`} />
      <CardBody className="p-0">
        {rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No requests yet. Students ask from their Results page within the set number of days.</p> : (
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Student</th><th className="px-4 py-2 font-medium">Course</th><th className="px-4 py-2 font-medium">Asked for</th><th className="px-4 py-2 font-medium">End-semester · grade</th><th className="px-4 py-2 font-medium">Decision</th></tr></thead>
            <tbody>{[...waiting, ...rows.filter((r) => r.status !== "requested")].map((r) => <Row key={r.id} r={r} canDecide={canDecide} />)}</tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
