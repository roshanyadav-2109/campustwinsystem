"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { downloadPdf } from "@/lib/pdf";
import { consolidatedPdf } from "@/components/courses/grade-card-pdf";
import { issueTranscript, revokeTranscript } from "@/app/dashboard/returns/actions";

export type Issued = { id: number; issued_at: string; revoked_at: string | null; cgpa: number | null; student: { full_name: string; admission_no: string } };

export function Transcripts({ issued, signers, verifyBase }: { issued: Issued[]; signers: string[]; verifyBase: string }) {
  const [adm, setAdm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Issue a transcript" />
        <CardBody className="flex flex-wrap items-end gap-2">
          <label className="text-[13px]">Admission number<Input className="mt-1 w-56" value={adm} onChange={(e) => setAdm(e.target.value)} aria-label="Admission number" /></label>
          <Button disabled={pending || !adm.trim()} onClick={() => start(async () => {
            const r = await issueTranscript(adm);
            if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
            await downloadPdf({ ...consolidatedPdf(r.student, r.rows, r.standing, r.percent, { verifyUrl: verifyBase + r.token, signers }) });
            setMsg({ ok: true, text: `Transcript issued for ${r.student.name}.` }); setAdm(""); router.refresh();
          })}>Issue and download</Button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Issued" />
        <CardBody className="p-0">
          {issued.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No transcripts issued yet.</p> : (
            <table className="w-full text-[13px]"><thead><tr className="text-left text-ink-500"><th className="px-4 py-2 font-medium">Student</th><th className="px-4 py-2 font-medium">Admission no.</th><th className="px-4 py-2 text-right font-medium">CGPA</th><th className="px-4 py-2 font-medium">Issued</th><th className="px-4 py-2" /></tr></thead>
              <tbody>{issued.map((t) => (
                <tr key={t.id} className="border-t border-hair"><td className="px-4 py-2">{t.student.full_name}</td><td className="px-4 py-2">{t.student.admission_no}</td>
                  <td className="tabular px-4 py-2 text-right">{t.cgpa ?? "-"}</td><td className="px-4 py-2">{t.issued_at.slice(0, 10).split("-").reverse().join("/")}</td>
                  <td className="px-4 py-2 text-right">{t.revoked_at ? <span className="text-down">Withdrawn</span> : <Button size="sm" variant="ghost" disabled={pending}
                    onClick={() => start(async () => { const r = await revokeTranscript(t.id); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Withdraw</Button>}</td></tr>))}</tbody></table>)}
        </CardBody>
      </Card>
    </div>
  );
}
