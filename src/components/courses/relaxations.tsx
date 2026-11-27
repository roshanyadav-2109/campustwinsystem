"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { askFeeExtension, decideRelaxation, cancelRelaxation } from "@/app/dashboard/relaxations/actions";

export type RelaxRow = {
  id: number; kind: "attendance" | "fees" | "unlock"; status: string; step: number; chain: string[]; reason: string; until: string | null; on_date: string | null; created_at: string;
  semester_id: number; student_id: number | null; subject_id: number | null; section_id: number | null;
  student: { full_name: string; admission_no: string } | null; subject: { name: string } | null; section: { name: string; class: { name: string } } | null;
  steps: { step_no: number; as_type: string; decision: string; note: string | null; at: string; staff: { full_name: string } | null }[];
};
export const WHO: Record<string, string> = { advisor: "Class teacher", head: "Principal / head", office: "Office" };
const KIND: Record<string, string> = { attendance: "Attendance relaxation", fees: "Fee extension", unlock: "Unlock attendance" };
const day = (d: string) => new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}
function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) { after?.(); router.refresh(); }
  });
  return { msg, pending, run };
}

function Row({ r, canAct }: { r: RelaxRow; canAct: boolean }) {
  const [note, setNote] = useState("");
  const { msg, pending, run } = useAct();
  const what = r.kind === "unlock" ? `${r.section ? `${r.section.class.name}-${r.section.name}` : ""}, ${r.subject?.name ?? ""}, ${r.on_date ? day(r.on_date) : ""}`
    : r.kind === "fees" ? `${r.student?.full_name ?? ""}: pay by ${r.until ? day(r.until) : ""}` : `${r.student?.full_name ?? ""}: ${r.subject?.name ?? ""}`;
  return (
    <li className="space-y-1.5 border-t border-hair px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold">{KIND[r.kind]}</span>
        <span className="text-[13px]">{what}</span>
        <span className={`text-[12px] font-medium ${r.status === "approved" ? "text-up" : r.status === "rejected" ? "text-down" : "text-ink-500"}`}>
          {r.status === "pending" ? `Waiting for ${WHO[r.chain[r.step]] ?? r.chain[r.step]}` : r.status[0].toUpperCase() + r.status.slice(1)}</span>
        <span className="text-[12px] text-ink-500">{day(r.created_at.slice(0, 10))}</span>
      </div>
      <p className="text-[13px] text-ink-700">{r.reason}</p>
      <ol className="flex flex-wrap gap-1.5 text-[12px]">
        {r.chain.map((t, i) => {
          const s = r.steps.find((x) => x.step_no === i + 1);
          return <li key={i} className={`rounded-sm border px-2 py-0.5 ${s?.decision === "approved" ? "border-up text-up" : s?.decision === "rejected" ? "border-down text-down" : "border-hair text-ink-500"}`}>
            {i + 1}. {WHO[t] ?? t}{s ? `: ${s.decision} by ${s.staff?.full_name ?? ""}${s.note ? ` (${s.note})` : ""}` : ""}</li>;
        })}
      </ol>
      {(canAct || r.status === "pending") && (
        <div className="flex flex-wrap items-center gap-2">
          {canAct && <>
            <Input className="h-8 w-64 text-[12px]" aria-label={`Note on request ${r.id}`} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" disabled={pending} onClick={() => run(() => decideRelaxation(r.id, true, note))}>Approve</Button>
            <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => decideRelaxation(r.id, false, note))}>Reject</Button>
          </>}
          {!canAct && r.status === "pending" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelRelaxation(r.id))}>Cancel request</Button>}
          <Msg m={msg} />
        </div>
      )}
    </li>
  );
}

export function RelaxationList({ title, rows, canAct = false, empty }: { title: string; rows: RelaxRow[]; canAct?: boolean; chain: Record<string, string[]>; empty: string }) {
  return (
    <Card>
      <CardHeader title={`${title} (${rows.length})`} />
      <CardBody className="p-0">
        {rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">{empty}</p> : <ul>{rows.map((r) => <Row key={r.id} r={r} canAct={canAct} />)}</ul>}
      </CardBody>
    </Card>
  );
}

// The office asks for a fee extension for a student, by admission number.
export function FeeExtensionForm() {
  const [adm, setAdm] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const { msg, pending, run } = useAct();
  return (
    <Card>
      <CardHeader title="Ask for a fee extension" action={<Msg m={msg} />} />
      <CardBody className="flex flex-wrap items-end gap-2">
        <p className="w-full text-[12px] text-ink-500">Overdue fees can hold back the hall ticket and results. An approved extension releases them until the date given.</p>
        <Input className="h-9 w-40 text-[13px]" aria-label="Admission number" placeholder="Admission no." value={adm} onChange={(e) => setAdm(e.target.value)} />
        <label className="text-[12px] text-ink-700">Will pay by<Input type="date" className="mt-0.5 h-9 text-[13px]" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        <Input className="h-9 w-72 text-[13px]" aria-label="Reason for the extension" placeholder="Reason, for example scholarship pending" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button disabled={pending} onClick={() => run(() => askFeeExtension(adm, until, reason), () => { setReason(""); setAdm(""); })}>Send</Button>
      </CardBody>
    </Card>
  );
}

// One button with a reason box: used on the lectures page for relaxation and unlock.
export function AskButton({ label, ariaLabel, send }: { label: string; ariaLabel: string; send: (reason: string) => Promise<{ ok: boolean; message?: string; error?: string }> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { msg, pending, run } = useAct();
  if (msg?.ok) return <Msg m={msg} />;
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{label}</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Input className="h-7 w-52 text-[12px]" aria-label={ariaLabel} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" disabled={pending} onClick={() => run(() => send(reason))}>Send</Button>
      <Msg m={msg} />
    </span>
  );
}
