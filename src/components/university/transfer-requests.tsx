"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { downloadPdf } from "@/lib/pdf";
import { transferMapping, decideTransferRequest, type MappingRow } from "@/app/dashboard/university/actions";

export type TransferRequestRow = { id: number; status: string; reason: string | null; order_no: string | null; created_at: string; decided_at: string | null; from_school: number; to_school: number;
  student_id: number; student: { full_name: string; admission_no: string } | null };

// Requests from campuses; central administration maps the courses, chooses the section and approves, with a transfer order.
export function TransferRequests({ rows, campuses, university }: { rows: TransferRequestRow[]; campuses: { id: number; name: string }[]; university: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [data, setData] = useState<{ rows: MappingRow[]; courses: { id: number; code: string; name: string }[]; sections: { id: number; label: string }[] } | null>(null);
  const [map, setMap] = useState<Record<number, number | "">>({});
  const [sec, setSec] = useState(0);
  const [note, setNote] = useState("");
  const [partial, setPartial] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const name = (id: number) => campuses.find((c) => c.id === id)?.name ?? "";
  const order = (r: TransferRequestRow) => downloadPdf({ filename: `Transfer order ${r.order_no}`, title: "Transfer order", meta: [`Order ${r.order_no}`, `Date ${(r.decided_at ?? "").slice(0, 10).split("-").reverse().join("/")}`], school: university,
    blocks: [{ kind: "text", lines: [`${r.student?.full_name ?? "The student"} (admission no. ${r.student?.admission_no ?? ""}) is transferred from ${name(r.from_school)} to ${name(r.to_school)}, in the same programme, with the grades and credits earned so far.`, r.reason ? `Reason: ${r.reason}` : ""].filter(Boolean) },
      { kind: "signatures", labels: ["Registrar", "Head of the campus left", "Head of the campus joined"] }] });
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader title={`Transfer requests (${rows.filter((r) => r.status === "requested").length} waiting)`} />
      <CardBody className="space-y-2 text-[13px]">
        {msg && <p role={msg.ok ? "status" : "alert"} className={`font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
        {rows.map((r) => (
          <div key={r.id} className="border-t border-hair pt-2">
            <div className="flex flex-wrap items-center gap-2"><b>{r.student?.full_name ?? "Student"}</b><span className="text-ink-500">{r.student?.admission_no}</span>
              {name(r.from_school)} to {name(r.to_school)}{r.reason ? `: ${r.reason}` : ""}
              {r.status === "requested" ? <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => {
                const d = await transferMapping(r.student_id, r.to_school); setData(d); setOpen(r.id); setSec(d.sections[0]?.id ?? 0);
                setMap(Object.fromEntries(d.rows.map((x) => [x.from_course_id, x.suggested ?? ""]))); })}>Review</Button>
                : <span className="text-ink-700">({r.status}{r.order_no ? `, order ${r.order_no}` : ""})</span>}
              {r.order_no && <Button size="sm" variant="ghost" onClick={() => void order(r)}>Transfer order</Button>}
            </div>
            {open === r.id && data && <div className="mt-2 space-y-2 rounded-sm border border-hair p-3">
              <p className="text-ink-700">Each course with a result and its equivalent at {name(r.to_school)}. Leave a course empty if it has no equivalent (its result is not carried).</p>
              <table className="w-full"><tbody>{data.rows.map((x) => (
                <tr key={x.from_course_id} className="border-t border-hair"><td className="py-1 pr-2">{x.code} {x.name}</td><td className="pr-2 text-ink-500">{x.credits} cr, {x.grade}</td>
                  <td className="py-1"><Select className="h-8 w-72 text-[12px]" aria-label={`Equivalent of ${x.code}`} value={map[x.from_course_id] ?? ""} onChange={(e) => setMap({ ...map, [x.from_course_id]: e.target.value ? Number(e.target.value) : "" })}>
                    <option value="">No equivalent</option>{data.courses.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</Select></td></tr>))}</tbody></table>
              <div className="flex flex-wrap items-end gap-2">
                <label>Section<Select className="mt-1 h-8 w-48" aria-label="Section at the new campus" value={sec} onChange={(e) => setSec(Number(e.target.value))}>{data.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></label>
                <label>Note<Input className="mt-1 h-8 w-56" aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />Approve even if some results are not carried</label>
                <Button size="sm" disabled={pending} onClick={() => start(async () => {
                  const m = Object.entries(map).filter(([, v]) => v !== "").map(([k, v]) => ({ from_course_id: Number(k), to_course_id: Number(v) }));
                  const x = await decideTransferRequest(r.id, true, sec, m, note, partial); setMsg(x.ok ? { ok: true, text: x.message } : { ok: false, text: x.error }); if (x.ok) { setOpen(null); router.refresh(); } })}>Approve and transfer</Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const x = await decideTransferRequest(r.id, false, null, [], note, false); setMsg(x.ok ? { ok: true, text: x.message } : { ok: false, text: x.error }); if (x.ok) { setOpen(null); router.refresh(); } })}>Decline</Button>
              </div>
            </div>}
          </div>))}
      </CardBody>
    </Card>
  );
}
