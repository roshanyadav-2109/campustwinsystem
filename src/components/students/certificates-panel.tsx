"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/students/student-form";
import { downloadPdf } from "@/lib/pdf";
import { KIND_LABEL, certificatePdf, type CertificateContent, type CertificateKind } from "@/core/certificates";
import {
  attachCertificateFile, cancelCertificate, certificateFileLink, issueCertificate, previewCertificate,
  printDuplicate, recordUploadedCertificate, signCertificateUpload,
} from "@/app/dashboard/students/[id]/certificates/actions";

export type CertRow = {
  id: number; kind: CertificateKind; number: string; issuedOn: string; source: "issued" | "uploaded" | "imported";
  status: "issued" | "cancelled"; copies: number; hasFile: boolean; token: string; content: CertificateContent | null; cancelReason: string | null;
};
const SOURCE: Record<CertRow["source"], string> = { issued: "Issued here", uploaded: "Uploaded copy", imported: "From the old register" };
const day = (iso: string) => iso.split("-").reverse().join("/");

async function uploadFile(studentId: number, file: File): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "The file is larger than 10 MB." };
  const t = await signCertificateUpload(studentId, file.type);
  if (!t.ok) return t;
  const put = await fetch(t.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  return put.ok ? { ok: true, key: t.key } : { ok: false, error: "The file could not be uploaded. Please try again." };
}

export function CertificatesPanel({ studentId, rows, canIssue, schoolName, kinds }: { studentId: number; rows: CertRow[]; canIssue: boolean; schoolName: string; kinds: CertificateKind[] }) {
  const [dialog, setDialog] = useState<"issue" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const download = async (r: CertRow, duplicate: boolean) => {
    if (!r.content) return;
    await downloadPdf(certificatePdf({ number: r.number, issuedOn: r.issuedOn, token: r.token, duplicate, cancelled: r.status === "cancelled", content: r.content, schoolName }));
  };
  const act = (fn: () => Promise<void>) => start(async () => { setError(null); try { await fn(); } catch { setError("That did not work. Please try again."); } });

  return (
    <Card>
      <CardHeader title="Certificates" action={canIssue && (
        <span className="flex gap-2">
          {kinds.length > 0 && <Button size="sm" onClick={() => setDialog("issue")}>Issue a certificate</Button>}
          <Button size="sm" variant="subtle" onClick={() => setDialog("upload")}>Upload a certificate</Button>
        </span>
      )} />
      <CardBody className="pt-1">
        {rows.length === 0 ? <p className="text-[14px] text-ink-500">No certificates yet.</p> : (
          <ul className="divide-y divide-hair">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className={`text-[14px] ${r.status === "cancelled" ? "text-ink-500 line-through" : "text-ink-900"}`}>
                    <span className="font-medium">{KIND_LABEL[r.kind]}</span> · {r.number}
                  </div>
                  <div className="text-[12px] text-ink-500">
                    {day(r.issuedOn)} · {SOURCE[r.source]}{r.copies ? ` · ${r.copies} duplicate${r.copies === 1 ? "" : "s"} printed` : ""}{r.status === "cancelled" ? ` · cancelled${r.cancelReason ? `: ${r.cancelReason}` : ""}` : ""}
                  </div>
                </div>
                <span className="flex flex-wrap gap-1.5">
                  {r.content && r.source === "issued" && <Button size="sm" variant="subtle" disabled={pending} onClick={() => act(() => download(r, r.copies > 0))}>Download</Button>}
                  {r.content && r.source === "issued" && r.status === "issued" && canIssue && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(async () => {
                      const res = await printDuplicate(r.id);
                      if (!res.ok) { setError(res.error); return; }
                      await download({ ...r, copies: r.copies + 1 }, true);
                    })}>Print duplicate</Button>
                  )}
                  {r.hasFile && <Button size="sm" variant="subtle" disabled={pending} onClick={() => act(async () => {
                    const res = await certificateFileLink(r.id);
                    if (res.ok) window.open(res.url, "_blank", "noopener"); else setError(res.error);
                  })}>Open file</Button>}
                  {!r.hasFile && r.source !== "issued" && canIssue && (
                    <label className="inline-flex h-8 cursor-pointer items-center rounded-sm border border-hair px-2.5 text-[13px] font-medium text-ink-900 hover:bg-panel">
                      Attach file
                      <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => {
                        const f = e.target.files?.[0]; if (!f) return;
                        act(async () => {
                          const up = await uploadFile(studentId, f);
                          if (!up.ok) { setError(up.error); return; }
                          const res = await attachCertificateFile(r.id, studentId, up.key);
                          if (!res.ok) setError(res.error);
                        });
                      }} />
                    </label>
                  )}
                  {r.status === "issued" && canIssue && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
                      const why = window.prompt(`Why is ${r.number} being cancelled?`);
                      if (why) act(async () => { const res = await cancelCertificate(r.id, why); if (!res.ok) setError(res.error); });
                    }}>Cancel</Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="mt-2 text-[13px] text-down">{error}</p>}
      </CardBody>
      {dialog === "issue" && <IssueDialog studentId={studentId} kinds={kinds} schoolName={schoolName} onClose={() => setDialog(null)} />}
      {dialog === "upload" && <UploadDialog studentId={studentId} onClose={() => setDialog(null)} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function IssueDialog({ studentId, kinds, schoolName, onClose }: { studentId: number; kinds: CertificateKind[]; schoolName: string; onClose: () => void }) {
  const uid = useId();
  const [kind, setKind] = useState<CertificateKind>(kinds[0]);
  const [v, setV] = useState<Record<string, string>>({ conduct: "Good", failed: "No", ncc: "No" });
  const [preview, setPreview] = useState<{ content: CertificateContent; blockers: string[]; warnings: string[] } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setV({ ...v, [k]: e.target.value }); setPreview(null); };
  const input = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} htmlFor={`${uid}-${k}`}><Input id={`${uid}-${k}`} value={v[k] ?? ""} onChange={set(k)} {...props} /></Field>
  );
  const check = () => start(async () => {
    setMsg(null);
    const r = await previewCertificate(studentId, kind, v);
    if (!r.ok) { setMsg(r.error); return; }
    setPreview({ content: r.content, blockers: r.blockers, warnings: r.warnings }); setConfirmed(false);
  });
  const issue = () => start(async () => {
    setMsg(null);
    const r = await issueCertificate(studentId, kind, v, confirmed);
    if (!r.ok) { setMsg(r.error); return; }
    await downloadPdf(certificatePdf({ number: r.number, issuedOn: r.issuedOn, token: r.token, duplicate: false, cancelled: false, content: r.content, schoolName }));
    onClose();
  });
  return (
    <Dialog title="Issue a certificate" onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-left">
        <Field label="Certificate" htmlFor={`${uid}-kind`}>
          <Select id={`${uid}-kind`} value={kind} onChange={(e) => { setKind(e.target.value as CertificateKind); setPreview(null); }}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        {kind === "transfer" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {input("applicationDate", "Date of application", { type: "date" })}
            {input("reason", "Reason for leaving", { maxLength: 200 })}
            {input("lastExam", "Last annual exam taken, with result", { maxLength: 200, placeholder: "Class VII annual exam 2026, passed" })}
            {input("failed", "Failed in the same class?", { maxLength: 40 })}
            {input("promotion", "Qualified for promotion? To which class", { maxLength: 200, placeholder: "Yes, to class VIII" })}
            {input("conduct", "General conduct", { maxLength: 60 })}
            {input("ncc", "NCC / Scouts / Guides", { maxLength: 200 })}
            {input("games", "Games and activities", { maxLength: 200 })}
            {input("progress", "Academic progress (state board format)", { maxLength: 60 })}
            <div className="sm:col-span-2"><Field label="Other remarks" htmlFor={`${uid}-rm`}><Textarea id={`${uid}-rm`} rows={2} maxLength={300} value={v.remarks ?? ""} onChange={set("remarks")} /></Field></div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {input("purpose", "Purpose", { maxLength: 200, placeholder: kind === "bonafide" ? "a passport application" : "admission to another school" })}
            {kind === "character" && input("conduct", "Conduct and character", { maxLength: 60 })}
            <div className="sm:col-span-2"><Field label="Other remarks" htmlFor={`${uid}-rm2`}><Textarea id={`${uid}-rm2`} rows={2} maxLength={300} value={v.remarks ?? ""} onChange={set("remarks")} /></Field></div>
          </div>
        )}
        {preview && (
          <div className="space-y-2 rounded-sm border border-hair p-3">
            <div className="text-[14px] font-semibold text-ink-900">{preview.content.title}</div>
            {preview.content.rows.length > 0 && (
              <table className="w-full text-[12.5px]"><tbody>
                {preview.content.rows.map(([k, val], i) => <tr key={i} className="border-t border-hair"><td className="py-1 pr-3 text-ink-700">{k}</td><td className="py-1 text-ink-900">{val || <span className="text-down">blank</span>}</td></tr>)}
              </tbody></table>
            )}
            {preview.content.paragraphs.map((p, i) => <p key={i} className="text-[13px] text-ink-900">{p}</p>)}
            {preview.blockers.map((b, i) => <p key={`b${i}`} role="alert" className="text-[13px] font-medium text-down">{b}</p>)}
            {preview.warnings.map((w, i) => <p key={`w${i}`} className="text-[13px] text-ink-900">Note: {w}</p>)}
            {!preview.blockers.length && preview.warnings.length > 0 && (
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have read the notes and want to issue it</label>
            )}
          </div>
        )}
      </div>
      {msg && <p role="alert" className="mt-3 text-left text-[13px] text-down">{msg}</p>}
      <div className="mt-4 flex gap-2">
        {!preview ? <Button disabled={pending} onClick={check}>{pending ? "Checking…" : "Check the certificate"}</Button>
          : <Button disabled={pending || preview.blockers.length > 0 || (preview.warnings.length > 0 && !confirmed)} onClick={issue}>{pending ? "Issuing…" : "Issue and download"}</Button>}
        <Button variant="ghost" disabled={pending} onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
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
    if (!file) { setMsg("Choose the file."); return; }
    const up = await uploadFile(studentId, file);
    if (!up.ok) { setMsg(up.error); return; }
    const r = await recordUploadedCertificate(studentId, { kind, number, issuedOn, key: up.key });
    if (r.ok) onClose(); else setMsg(r.error);
  });
  return (
    <Dialog title="Upload a certificate" onClose={onClose}>
      <div className="grid gap-3 text-left sm:grid-cols-2">
        <p className="text-[13px] text-ink-700 sm:col-span-2">For a certificate issued outside CampusTwin, for example before the school started using it. It keeps its own number and date.</p>
        <Field label="Certificate" htmlFor={`${uid}-k`}>
          <Select id={`${uid}-k`} value={kind} onChange={(e) => setKind(e.target.value as CertificateKind)}>
            {(Object.keys(KIND_LABEL) as CertificateKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Certificate number" htmlFor={`${uid}-n`}><Input id={`${uid}-n`} maxLength={40} value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field label="Date of issue" htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></Field>
        <Field label="File (PDF, JPG or PNG, up to 10 MB)" htmlFor={`${uid}-f`}><input id={`${uid}-f`} type="file" accept="application/pdf,image/jpeg,image/png" className="text-[13px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
      {msg && <p role="alert" className="mt-3 text-left text-[13px] text-down">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <Button disabled={pending || !number.trim() || !issuedOn || !file} onClick={save}>{pending ? "Uploading…" : "Upload"}</Button>
        <Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
