"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { KIND_LABEL, type CertificateKind } from "@/core/certificates";
import { recordUploadedCertificate, studentsByAdmissionNo } from "@/app/dashboard/students/[id]/certificates/actions";
import { CERT_TYPES, uploadCertificateFile } from "@/components/students/certificates-panel";

// Many certificates at once: each PDF named by the student's admission number
// (GFP260001.pdf, "GFP260001 TC.pdf", GFP260001_tc.pdf). One type and date for
// the batch; files whose admission number is not found are listed, not saved.
const admissionFromName = (name: string) => name.replace(/\.[^.]+$/, "").split(/[\s_]+/)[0].trim();

export function CertificateBulkUpload() {
  const uid = useId();
  const [kind, setKind] = useState<CertificateKind>("transfer");
  const [issuedOn, setIssuedOn] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [match, setMatch] = useState<Record<string, { id: number; name: string }> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const choose = (list: FileList | null) => start(async () => {
    setMsg(null); setMatch(null);
    const fs = Array.from(list ?? []).slice(0, 300);
    setFiles(fs);
    if (!fs.length) return;
    const r = await studentsByAdmissionNo(fs.map((f) => admissionFromName(f.name)));
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setMatch(r.found);
  });
  const known = files.filter((f) => match?.[admissionFromName(f.name).toUpperCase()]);
  const unknown = files.filter((f) => match && !match[admissionFromName(f.name).toUpperCase()]);

  const upload = () => start(async () => {
    setMsg(null);
    let done = 0; const failed: string[] = [];
    for (const f of known) {
      const st = match![admissionFromName(f.name).toUpperCase()];
      const up = await uploadCertificateFile(st.id, f);
      if (!up.ok) { failed.push(f.name); continue; }
      const r = await recordUploadedCertificate(st.id, { kind, number: "", issuedOn, key: up.key });
      if (r.ok) done++; else failed.push(f.name);
    }
    setFiles([]); setMatch(null);
    setMsg({ ok: failed.length === 0, text: `${done} certificate${done === 1 ? "" : "s"} uploaded.${failed.length ? ` Not uploaded: ${failed.slice(0, 8).join(", ")}${failed.length > 8 ? " and more" : ""}.` : ""}` });
  });

  return (
    <Card>
      <CardHeader title="Upload many certificates" />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-700">Name each PDF by the student&apos;s admission number, for example GFP260001.pdf. Choose the type and date for the whole batch.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Certificate" htmlFor={`${uid}-k`}>
            <Select id={`${uid}-k`} value={kind} onChange={(e) => setKind(e.target.value as CertificateKind)}>
              {(Object.keys(KIND_LABEL) as CertificateKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Date of issue" htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></Field>
        </div>
        <label htmlFor={`${uid}-f`} className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-hair bg-surface px-3 py-2 text-[14px] font-medium text-ink-900 hover:bg-panel">Choose PDFs</label>
        <input id={`${uid}-f`} type="file" multiple accept={CERT_TYPES} className="sr-only" onChange={(e) => choose(e.target.files)} />
        {match && (
          <div className="space-y-2 text-[13px]">
            <p className="text-ink-900">{known.length} of {files.length} files match a student.</p>
            {unknown.length > 0 && <p className="text-down">No student with these admission numbers: {unknown.slice(0, 10).map((f) => f.name).join(", ")}{unknown.length > 10 ? " and more" : ""}.</p>}
            <Button disabled={pending || !known.length || !issuedOn} onClick={upload}>{pending ? "Uploading…" : `Upload ${known.length}`}</Button>
          </div>
        )}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
