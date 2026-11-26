"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/students/student-form";
import { KIND_LABEL, type CertificateKind } from "@/core/certificates";
import { attachCertificateFile, cancelCertificate, certificateFileLink, recordUploadedCertificate, signCertificateUpload } from "@/app/dashboard/students/[id]/certificates/actions";

// A student's certificates: the PDFs the office uploaded, and certificates
// recorded from the old register (a file can be attached to those later).
export type CertRow = {
  id: number; kind: CertificateKind; number: string | null; issuedOn: string; source: "issued" | "uploaded" | "imported";
  status: "issued" | "cancelled"; hasFile: boolean; cancelReason: string | null;
};
const day = (iso: string) => iso.split("-").reverse().join("/");
export const CERT_TYPES = "application/pdf,image/jpeg,image/png";

export async function uploadCertificateFile(studentId: number, file: File): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: `${file.name} is larger than 10 MB.` };
  const t = await signCertificateUpload(studentId, file.type);
  if (!t.ok) return t;
  const put = await fetch(t.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  return put.ok ? { ok: true, key: t.key } : { ok: false, error: `${file.name} could not be uploaded. Please try again.` };
}

export function CertificatesPanel({ studentId, rows, canUpload }: { studentId: number; rows: CertRow[]; canUpload: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<void>) => start(async () => { setError(null); try { await fn(); } catch { setError("That did not work. Please try again."); } });

  return (
    <Card>
      <CardHeader title="Certificates" action={canUpload && <Button size="sm" onClick={() => setOpen(true)}>Upload a certificate</Button>} />
      <CardBody className="pt-1">
        {rows.length === 0 ? <p className="text-[14px] text-ink-500">No certificates on file.</p> : (
          <ul className="divide-y divide-hair">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className={`text-[14px] ${r.status === "cancelled" ? "text-ink-500 line-through" : "text-ink-900"}`}>
                    <span className="font-medium">{KIND_LABEL[r.kind]}</span>{r.number ? ` · ${r.number}` : ""}
                  </div>
                  <div className="text-[12px] text-ink-500">
                    Issued {day(r.issuedOn)}{r.source === "imported" ? " · from the old register" : ""}{!r.hasFile ? " · no file yet" : ""}
                    {r.status === "cancelled" ? ` · withdrawn${r.cancelReason ? `: ${r.cancelReason}` : ""}` : ""}
                  </div>
                </div>
                <span className="flex flex-wrap gap-1.5">
                  {r.hasFile && <Button size="sm" variant="subtle" disabled={pending} onClick={() => act(async () => {
                    const res = await certificateFileLink(r.id);
                    if (res.ok) window.open(res.url, "_blank", "noopener"); else setError(res.error);
                  })}>Open</Button>}
                  {!r.hasFile && canUpload && r.status === "issued" && (
                    <label className="inline-flex h-8 cursor-pointer items-center rounded-sm border border-hair px-2.5 text-[13px] font-medium text-ink-900 hover:bg-panel">
                      Attach PDF
                      <input type="file" accept={CERT_TYPES} className="sr-only" onChange={(e) => {
                        const f = e.target.files?.[0]; if (!f) return;
                        act(async () => {
                          const up = await uploadCertificateFile(studentId, f);
                          if (!up.ok) { setError(up.error); return; }
                          const res = await attachCertificateFile(r.id, studentId, up.key);
                          if (!res.ok) setError(res.error);
                        });
                      }} />
                    </label>
                  )}
                  {r.status === "issued" && canUpload && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
                      const why = window.prompt("Why is this certificate being withdrawn?");
                      if (why) act(async () => { const res = await cancelCertificate(r.id, why); if (!res.ok) setError(res.error); });
                    }}>Withdraw</Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="mt-2 text-[13px] text-down">{error}</p>}
      </CardBody>
      {open && <UploadDialog studentId={studentId} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function UploadDialog({ studentId, onClose }: { studentId: number; onClose: () => void }) {
  const uid = useId();
  const [kind, setKind] = useState<CertificateKind>("transfer");
  const [number, setNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    setMsg(null);
    if (!file) { setMsg("Choose the PDF."); return; }
    const up = await uploadCertificateFile(studentId, file);
    if (!up.ok) { setMsg(up.error); return; }
    const r = await recordUploadedCertificate(studentId, { kind, number, issuedOn, key: up.key });
    if (r.ok) onClose(); else setMsg(r.error);
  });
  return (
    <Dialog title="Upload a certificate" onClose={onClose}>
      <div className="grid gap-3 text-left sm:grid-cols-2">
        <Field label="Certificate" htmlFor={`${uid}-k`}>
          <Select id={`${uid}-k`} value={kind} onChange={(e) => setKind(e.target.value as CertificateKind)}>
            {(Object.keys(KIND_LABEL) as CertificateKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Date of issue" htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></Field>
        <Field label="Certificate number (optional)" htmlFor={`${uid}-n`}><Input id={`${uid}-n`} maxLength={40} value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field label="PDF (or JPG / PNG), up to 10 MB" htmlFor={`${uid}-f`}><input id={`${uid}-f`} type="file" accept={CERT_TYPES} className="text-[13px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
      {msg && <p role="alert" className="mt-3 text-left text-[13px] text-down">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <Button disabled={pending || !issuedOn || !file} onClick={save}>{pending ? "Uploading…" : "Upload"}</Button>
        <Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
