"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { downloadPdf } from "@/lib/pdf";
import { consolidatedPdf } from "@/components/courses/grade-card-pdf";
import { issueTranscript, revokeTranscript, reprintTranscript, decideTranscriptRequest, setTranscriptFee, requestTranscriptFor } from "@/app/dashboard/returns/actions";

export type Issued = { id: number; serial: string | null; issued_at: string; revoked_at: string | null; cgpa: number | null; student: { full_name: string; admission_no: string } };

export type TRequest = { id: number; copies: number; purpose: string | null; sealed: boolean; status: string; created_at: string; delivery: string; address: string | null; note: string | null; student: { full_name: string; admission_no: string }; invoice: { status: string } | null };
export function Transcripts({ issued, signers, verifyBase, requests = [], fee = null, canWaive = false }: { issued: Issued[]; signers: string[]; verifyBase: string; requests?: TRequest[]; fee?: number | null; canWaive?: boolean }) {
  const [feeV, setFeeV] = useState(fee == null ? "" : String(Number(fee)));
  const [why, setWhy] = useState<Record<number, string>>({});
  const [onBehalf, setOnBehalf] = useState({ adm: "", copies: "1", purpose: "", sealed: false, delivery: "collect", address: "" });
  const [adm, setAdm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={`Requests from students (${requests.filter((r) => r.status === "requested").length} waiting)`} />
        <CardBody className="space-y-2 text-[13px]">
          {requests.length === 0 ? <p className="text-ink-500">No requests yet. Students ask on their Results page.</p> : <ul className="space-y-1">{requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-hair pt-1"><b>{r.student.full_name}</b><span className="text-ink-500">{r.student.admission_no}</span>
              {r.copies} cop{r.copies === 1 ? "y" : "ies"}{r.sealed ? ", sealed" : ""}{r.purpose ? `, for ${r.purpose}` : ""}{r.delivery !== "collect" ? `, by ${r.delivery}${r.address ? ` to ${r.address}` : ""}` : ", to collect"}
              {r.status !== "requested" ? <span className="text-ink-700">({r.status}{r.note ? `: ${r.note}` : ""})</span> : <>
                {r.invoice && r.invoice.status !== "paid" && <span className="text-down">fee not paid</span>}
                <Input className="h-8 w-48 text-[12px]" aria-label={`Note or reason for ${r.student.full_name}`} placeholder={canWaive ? "Reason (decline or waive dues)" : "Reason to decline"} value={why[r.id] ?? ""} onChange={(e) => setWhy({ ...why, [r.id]: e.target.value })} />
                <Button size="sm" disabled={pending} onClick={() => start(async () => { const x = await decideTranscriptRequest(r.id, true, "", ""); setMsg(x.ok ? { ok: true, text: x.message ?? "" } : { ok: false, text: x.error }); router.refresh(); })}>Issue</Button>
                {canWaive && <Button size="sm" variant="subtle" disabled={pending || !(why[r.id] ?? "").trim()} onClick={() => start(async () => { const x = await decideTranscriptRequest(r.id, true, "", why[r.id] ?? ""); setMsg(x.ok ? { ok: true, text: x.message ?? "" } : { ok: false, text: x.error }); router.refresh(); })}>Issue, waiving dues</Button>}
                <Button size="sm" variant="ghost" disabled={pending || !(why[r.id] ?? "").trim()} onClick={() => start(async () => { const x = await decideTranscriptRequest(r.id, false, why[r.id] ?? ""); setMsg(x.ok ? { ok: true, text: x.message ?? "" } : { ok: false, text: x.error }); router.refresh(); })}>Decline</Button></>}
            </li>))}</ul>}
          <div className="flex flex-wrap items-end gap-2 border-t border-hair pt-2">
            <span className="w-full text-ink-700">For a student or former student (by admission number):</span>
            <Input className="h-8 w-36" aria-label="Admission number for a transcript request" placeholder="Admission no." value={onBehalf.adm} onChange={(e) => setOnBehalf({ ...onBehalf, adm: e.target.value })} />
            <Input className="h-8 w-16" aria-label="Copies requested" inputMode="numeric" value={onBehalf.copies} onChange={(e) => setOnBehalf({ ...onBehalf, copies: e.target.value })} />
            <Input className="h-8 w-40" aria-label="Purpose of the transcript" placeholder="Purpose" value={onBehalf.purpose} onChange={(e) => setOnBehalf({ ...onBehalf, purpose: e.target.value })} />
            <select className="h-8 rounded-sm border border-hair text-[12px]" aria-label="How the transcript is sent" value={onBehalf.delivery} onChange={(e) => setOnBehalf({ ...onBehalf, delivery: e.target.value })}>
              <option value="collect">Collect</option><option value="post">Post</option><option value="courier">Courier</option><option value="email">Email</option></select>
            {onBehalf.delivery !== "collect" && <Input className="h-8 w-64" aria-label="Address or email" placeholder="Address or email" value={onBehalf.address} onChange={(e) => setOnBehalf({ ...onBehalf, address: e.target.value })} />}
            <label className="flex items-center gap-1"><input type="checkbox" checked={onBehalf.sealed} onChange={(e) => setOnBehalf({ ...onBehalf, sealed: e.target.checked })} />Sealed</label>
            <Button size="sm" variant="subtle" disabled={pending || !onBehalf.adm.trim()} onClick={() => start(async () => { const x = await requestTranscriptFor(onBehalf.adm, Number(onBehalf.copies) || 1, onBehalf.purpose, onBehalf.sealed, onBehalf.delivery, onBehalf.address); setMsg(x.ok ? { ok: true, text: x.message ?? "" } : { ok: false, text: x.error }); if (x.ok) router.refresh(); })}>Add the request</Button>
          </div>
          <label className="flex items-center gap-2">Fee per copy (Rs)<Input className="h-8 w-24" aria-label="Transcript fee per copy" inputMode="decimal" value={feeV} onChange={(e) => setFeeV(e.target.value)} />
            <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const x = await setTranscriptFee(feeV); setMsg(x.ok ? { ok: true, text: x.message ?? "" } : { ok: false, text: x.error }); })}>Save</Button></label>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Issue a transcript" />
        <CardBody className="flex flex-wrap items-end gap-2">
          <label className="text-[13px]">Admission number<Input className="mt-1 w-56" value={adm} onChange={(e) => setAdm(e.target.value)} aria-label="Admission number" /></label>
          <Button disabled={pending || !adm.trim()} onClick={() => start(async () => {
            const r = await issueTranscript(adm);
            if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
            await downloadPdf(consolidatedPdf(r.student, r.rows, r.standing, r.percent, { verifyUrl: verifyBase + r.token, signers, serial: r.serial }));
            setMsg({ ok: true, text: `Transcript issued for ${r.student.name}.` }); setAdm(""); router.refresh();
          })}>Issue and download</Button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Issued" />
        <CardBody className="p-0">
          {issued.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No transcripts issued yet.</p> : (
            <table className="w-full text-[13px]"><thead><tr className="text-left text-ink-500"><th className="px-4 py-2 font-medium">No.</th><th className="px-4 py-2 font-medium">Student</th><th className="px-4 py-2 font-medium">Admission no.</th><th className="px-4 py-2 text-right font-medium">CGPA</th><th className="px-4 py-2 font-medium">Issued</th><th className="px-4 py-2" /></tr></thead>
              <tbody>{issued.map((t) => (
                <tr key={t.id} className="border-t border-hair"><td className="px-4 py-2">{t.serial ?? "-"}</td><td className="px-4 py-2">{t.student.full_name}</td><td className="px-4 py-2">{t.student.admission_no}</td>
                  <td className="tabular px-4 py-2 text-right">{t.cgpa ?? "-"}</td><td className="px-4 py-2">{t.issued_at.slice(0, 10).split("-").reverse().join("/")}</td>
                  <td className="px-4 py-2 text-right">{t.revoked_at ? <span className="text-down">Withdrawn</span> : <><Button size="sm" variant="subtle" disabled={pending}
                    onClick={() => start(async () => { const r = await reprintTranscript(t.id); if (!r.ok) { setMsg({ ok: false, text: r.error }); return; } await downloadPdf(consolidatedPdf(r.student, r.rows, r.standing, r.percent, { verifyUrl: verifyBase + r.token, signers, serial: r.serial })); })}>Reprint</Button> <Button size="sm" variant="ghost" disabled={pending}
                    onClick={() => start(async () => { const r = await revokeTranscript(t.id); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Withdraw</Button></>}</td></tr>))}</tbody></table>)}
        </CardBody>
      </Card>
    </div>
  );
}
