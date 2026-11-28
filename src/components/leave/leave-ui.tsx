"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { useT } from "@/i18n/provider";
import { signLeaveProof, applyStudentLeave, leaveProofLink, applyLeave, decideLeave } from "@/app/dashboard/leave/actions";

export function LeaveForm({ students }: { students: { id: number; full_name: string }[] }) {
  const t = useT();
  const [studentId, setStudentId] = useState<number | "">(students[0]?.id ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  function submit() {
    setDone(false);
    start(async () => {
      const res = await applyLeave({ studentId: Number(studentId), fromDate: from, toDate: to, reason });
      if (res.ok) { setFrom(""); setTo(""); setReason(""); setDone(true); setTimeout(() => setDone(false), 2500); }
    });
  }

  return (
    <Card>
      <CardHeader title={t("leave.apply")} />
      <CardBody className="space-y-3 pt-1">
        {students.length > 1 && (
          <Field label={t("common.student")}>
            <Select value={studentId} onChange={(e) => setStudentId(Number(e.target.value))}>
              {students.map((c) => (<option key={c.id} value={c.id}>{c.full_name}</option>))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("leave.from")}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t("leave.to")}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label={t("leave.reason")}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={pending || !from || !to || !reason}>{pending ? t("common.saving") : t("leave.apply")}</Button>
          {done && <span className="text-[13px] font-medium text-up">{t("common.saved")}</span>}
        </div>
      </CardBody>
    </Card>
  );
}

export function LeaveDecision({ id }: { id: number }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { await decideLeave(id, "approved"); })}>{t("leave.approve")}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await decideLeave(id, "rejected"); })}>{t("leave.reject")}</Button>
    </div>
  );
}

// Colleges: leave, medical (with a certificate) or on duty (with proof from the event); students apply themselves too.
export function StudentLeaveForm({ students }: { students: { id: number; full_name: string }[] }) {
  const [studentId, setStudentId] = useState<number>(students[0]?.id ?? 0);
  const [kind, setKind] = useState<"leave" | "medical" | "on_duty">("leave");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const needsProof = kind !== "leave";
  return (
    <Card>
      <CardHeader title="Ask for leave or on duty" />
      <CardBody className="space-y-3 pt-1">
        {students.length > 1 && <Field label="Student"><Select value={studentId} onChange={(e) => setStudentId(Number(e.target.value))}>{students.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</Select></Field>}
        <Field label="Kind"><Select aria-label="Kind of request" value={kind} onChange={(e) => setKind(e.target.value as "leave" | "medical" | "on_duty")}>
          <option value="leave">Leave</option><option value="medical">Medical leave (with a certificate)</option><option value="on_duty">On duty: an event, competition or sports (with proof)</option></Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label={kind === "on_duty" ? "The event and your part in it" : "Reason"}><Textarea aria-label="Reason for the request" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        {needsProof && <Field label={kind === "medical" ? "Medical certificate (PDF, JPG or PNG)" : "Proof: certificate or letter from the event"}>
          <input type="file" aria-label="Proof file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
        <div className="flex items-center gap-3">
          <Button disabled={pending || !from || !to || !reason.trim() || (needsProof && !file)} onClick={() => start(async () => {
            let key: string | null = null;
            if (needsProof && file) {
              const s = await signLeaveProof(studentId, file.type, file.size);
              if (!s.ok) { setMsg({ ok: false, text: s.error }); return; }
              const put = await fetch(s.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
              if (!put.ok) { setMsg({ ok: false, text: "The upload failed. Try again." }); return; }
              key = s.key;
            }
            const r = await applyStudentLeave({ studentId, fromDate: from, toDate: to, reason, kind, fileKey: key });
            setMsg(r.ok ? { ok: true, text: "Sent for review. You will be told the decision." } : { ok: false, text: r.error });
            if (r.ok) { setFrom(""); setTo(""); setReason(""); setFile(null); }
          })}>{pending ? "Sending…" : "Send"}</Button>
          {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
        </div>
      </CardBody>
    </Card>
  );
}
export function ProofLink({ leaveId }: { leaveId: number }) {
  const [err, setErr] = useState<string | null>(null);
  return (<>
    <button type="button" className="text-[12px] text-[#0F6CBD] hover:underline" onClick={() => { const w = window.open("about:blank", "_blank"); void leaveProofLink(leaveId).then((r) => { if (r.ok && w) { w.opener = null; w.location.href = r.url; } else { w?.close(); setErr(r.ok ? "Allow pop-ups to open it." : r.error); } }); }}>Open proof</button>
    {err && <span className="ml-2 text-[12px] text-down">{err}</span>}</>);
}
