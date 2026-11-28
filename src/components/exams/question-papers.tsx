"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { assignSetter, moderatePaper, signPaperUpload, submitPaper, paperLink, paperLog } from "@/app/dashboard/question-papers/actions";

export type SessionPaper = { paper_id: number; subject: string; class_name: string | null; exam_date: string; starts_at: string; ends_at: string | null; central: boolean;
  qp_id: number | null; setter_id: number | null; setter: string | null; moderator_id: number | null; moderator: string | null; status: string | null; note: string | null; release_minutes: number | null; has_file: boolean; can_manage: boolean };
export type MyPaper = { qp_id: number; role: "setter" | "moderator"; institution: string; exam: string; subject: string; class_name: string | null; exam_date: string; status: string; note: string | null; has_file: boolean };
type Msg = { ok: boolean; text: string } | null;
const dmy = (d: string) => d.split("-").reverse().join("/");
const STATUS: Record<string, string> = { assigned: "Being set", submitted: "With the moderator", returned: "Sent back", approved: "Approved" };
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p> : null);

// The tab is opened at the click (so a pop-up blocker allows it), then sent to the paper.
async function open(qpId: number, paperId: number | null, setMsg: (m: Msg) => void) {
  const w = window.open("about:blank", "_blank");
  const r = await paperLink(qpId, paperId);
  if (r.ok && w) { w.opener = null; w.location.href = r.url; }
  else { w?.close(); setMsg({ ok: false, text: r.ok ? "Allow pop-ups to open the paper." : r.error }); }
}

// Papers this teacher sets or moderates.
export function MyQuestionPapers({ rows }: { rows: MyPaper[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const upload = (qp: number, f: File) => start(async () => {
    const s = await signPaperUpload(qp, f.type, f.size);
    if (!s.ok) { setMsg({ ok: false, text: s.error }); return; }
    const put = await fetch(s.uploadUrl, { method: "PUT", body: f, headers: { "Content-Type": f.type } });
    if (!put.ok) { setMsg({ ok: false, text: "The upload failed. Try again." }); return; }
    const r = await submitPaper(qp, s.key);
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    router.refresh();
  });
  return (
    <Card>
      <CardHeader title="Papers you set or moderate" />
      <CardBody className="space-y-2 text-[13px]">
        <Note m={msg} />
        {rows.map((r) => (
          <div key={`${r.role}-${r.qp_id}`} className="flex flex-wrap items-center gap-2 border-t border-hair pt-2 first:border-0 first:pt-0">
            <b>{r.subject}</b><span className="text-ink-500">{r.class_name ?? ""} · {r.exam} · {r.institution} · {dmy(r.exam_date)}</span>
            <span className={r.status === "approved" ? "text-up" : r.status === "returned" ? "text-down" : "text-ink-700"}>{STATUS[r.status] ?? r.status}</span>
            {r.note && <span className="text-[12px] text-down">Moderator: {r.note}</span>}
            {r.has_file && <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => open(r.qp_id, null, setMsg))}>Open</Button>}
            {r.role === "setter" && r.status !== "approved" && (
              <label className="cursor-pointer text-[#0F6CBD] hover:underline">{r.has_file ? "Upload a new version" : "Upload the paper"}
                <input type="file" className="sr-only" aria-label={`Question paper for ${r.subject}`} accept="application/pdf,.docx" disabled={pending}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(r.qp_id, f); }} /></label>)}
            {r.role === "moderator" && r.status === "submitted" && <>
              <Input className="h-8 w-56 text-[12px]" aria-label={`Moderator's note on ${r.subject}`} placeholder="What should change (to send back)" value={note[r.qp_id] ?? ""} onChange={(e) => setNote({ ...note, [r.qp_id]: e.target.value })} />
              <Button size="sm" disabled={pending} onClick={() => start(async () => { const x = await moderatePaper(r.qp_id, true, note[r.qp_id] ?? ""); setMsg(x.ok ? { ok: true, text: x.message } : { ok: false, text: x.error }); router.refresh(); })}>Approve</Button>
              <Button size="sm" variant="ghost" disabled={pending || !(note[r.qp_id] ?? "").trim()} onClick={() => start(async () => { const x = await moderatePaper(r.qp_id, false, note[r.qp_id] ?? ""); setMsg(x.ok ? { ok: true, text: x.message } : { ok: false, text: x.error }); router.refresh(); })}>Send back</Button></>}
          </div>))}
      </CardBody>
    </Card>
  );
}

// The confidential section (or central administration): setters and moderators for each paper of an exam.
// A campus that copied a common exam sees the central paper and opens it near the start.
export function SessionQuestionPapers({ rows, staff }: { rows: SessionPaper[]; staff: { id: number; name: string }[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [edit, setEdit] = useState<Record<number, { setter: string; moderator: string; release: string }>>({});
  const [log, setLog] = useState<{ qp: number; rows: { at: string; campus: string | null; who: string }[] } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!rows.length) return <p className="text-[13px] text-ink-500">This exam has no papers yet.</p>;
  return (
    <Card>
      <CardHeader title="Question papers" />
      <CardBody className="p-0">
        <div className="px-4 pt-2"><Note m={msg} /></div>
        <table className="w-full text-[13px]"><tbody>{rows.map((r) => {
          const e = edit[r.paper_id] ?? { setter: String(r.setter_id ?? ""), moderator: String(r.moderator_id ?? ""), release: String(r.release_minutes ?? 60) };
          return (
            <tr key={r.paper_id} className="border-t border-hair align-top">
              <td className="px-4 py-2"><b>{r.subject}</b> <span className="text-ink-500">{r.class_name ?? ""}</span><span className="block text-[12px] text-ink-500">{dmy(r.exam_date)} {r.starts_at.slice(0, 5)}{r.central ? " · set centrally" : ""}</span></td>
              <td className="px-2 py-2">{r.status ? <span className={r.status === "approved" ? "text-up" : r.status === "returned" ? "text-down" : ""}>{STATUS[r.status]}</span> : <span className="text-ink-500">No setter yet</span>}
                {r.setter && <span className="block text-[12px] text-ink-500">Setter {r.setter}{r.moderator ? `, moderator ${r.moderator}` : ""}</span>}</td>
              <td className="px-2 py-2">{r.can_manage && staff.length > 0 && <span className="flex flex-wrap items-center gap-1">
                <Select className="h-8 w-44 text-[12px]" aria-label={`Setter for ${r.subject}`} value={e.setter} onChange={(x) => setEdit({ ...edit, [r.paper_id]: { ...e, setter: x.target.value } })}>
                  <option value="">Setter</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                <Select className="h-8 w-44 text-[12px]" aria-label={`Moderator for ${r.subject}`} value={e.moderator} onChange={(x) => setEdit({ ...edit, [r.paper_id]: { ...e, moderator: x.target.value } })}>
                  <option value="">Moderator</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                <Input className="h-8 w-16 text-[12px]" aria-label={`Minutes before the start for ${r.subject}`} inputMode="numeric" value={e.release} onChange={(x) => setEdit({ ...edit, [r.paper_id]: { ...e, release: x.target.value } })} />
                <span className="text-[11px] text-ink-500">min before</span>
                <Button size="sm" variant="subtle" disabled={pending || !e.setter} onClick={() => start(async () => { const x = await assignSetter(r.paper_id, Number(e.setter), e.moderator ? Number(e.moderator) : null, Number(e.release) || 60); setMsg(x.ok ? { ok: true, text: x.message } : { ok: false, text: x.error }); router.refresh(); })}>Save</Button></span>}</td>
              <td className="px-4 py-2 text-right">{r.qp_id && r.has_file && <span className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => open(r.qp_id!, r.paper_id, setMsg))}>Open paper</Button>
                {r.can_manage && <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => setLog({ qp: r.qp_id!, rows: await paperLog(r.qp_id!) }))}>Who opened it</Button>}</span>}</td>
            </tr>); })}</tbody></table>
        {log && <div className="border-t border-hair px-4 py-2 text-[12px]">{log.rows.length ? log.rows.map((x, i) => <p key={i}>{new Date(x.at).toLocaleString("en-IN")} · {x.who}{x.campus ? ` · ${x.campus}` : ""}</p>) : <p className="text-ink-500">Not opened yet.</p>}</div>}
        <p className="px-4 pb-3 pt-1 text-[12px] text-ink-500">The exam cell can open an approved paper only from the set minutes before it starts until it ends; each opening is recorded.</p>
      </CardBody>
    </Card>
  );
}
