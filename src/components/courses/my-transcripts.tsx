"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { downloadPdf } from "@/lib/pdf";
import { consolidatedPdf } from "@/components/courses/grade-card-pdf";
import { requestTranscript, reprintTranscript } from "@/app/dashboard/returns/actions";

export type MyTranscript = { id: number; serial: string | null; issued_at: string; revoked_at: string | null };
export type MyTRequest = { id: number; copies: number; status: string; created_at: string };

// A student's transcripts: ask for one (fee per copy), and download those issued.
export function MyTranscripts({ studentId, issued, requests, fee, signers, verifyBase }: { studentId: number; issued: MyTranscript[]; requests: MyTRequest[]; fee: number | null; signers: string[]; verifyBase: string }) {
  const [copies, setCopies] = useState("1");
  const [purpose, setPurpose] = useState("");
  const [sealed, setSealed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const waiting = requests.find((r) => r.status === "requested");
  return (
    <Card>
      <CardHeader title="Transcripts" />
      <CardBody className="space-y-2 text-[13px]">
        {issued.filter((t) => !t.revoked_at).map((t) => (
          <p key={t.id} className="flex items-center gap-2">Transcript {t.serial ?? ""}, issued {t.issued_at.slice(0, 10).split("-").reverse().join("/")}
            <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const r = await reprintTranscript(t.id); if (!r.ok) { setMsg({ ok: false, text: r.error }); return; } await downloadPdf(consolidatedPdf(r.student, r.rows, r.standing, r.percent, { verifyUrl: verifyBase + r.token, signers, serial: r.serial })); })}>Download</Button></p>))}
        {waiting ? <p className="text-ink-700">Your request for {waiting.copies} cop{waiting.copies === 1 ? "y" : "ies"} is with the exam cell.</p> : (
          <div className="flex flex-wrap items-end gap-2">
            <label>Copies<Input className="mt-1 h-8 w-16" inputMode="numeric" aria-label="Copies" value={copies} onChange={(e) => setCopies(e.target.value)} /></label>
            <label>For<Input className="mt-1 h-8 w-48" aria-label="Purpose" placeholder="e.g. higher studies" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={sealed} onChange={(e) => setSealed(e.target.checked)} />Sealed copies</label>
            <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await requestTranscript(studentId, Number(copies) || 1, purpose, sealed); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>
              Ask for a transcript{fee ? ` (Rs ${Number(fee) * (Number(copies) || 1)})` : ""}</Button>
          </div>)}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
