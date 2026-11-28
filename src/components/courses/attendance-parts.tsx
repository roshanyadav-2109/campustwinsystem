"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { requestCorrection, decideCorrection, setSubjectParts, saveBatches, addPartAllotment, removePartAllotment } from "@/app/dashboard/lectures/actions";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p> : null);
const PART: Record<string, string> = { theory: "Theory", practical: "Practical", tutorial: "Tutorial" };
const dmy = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export type PartRow = { subject_id: number; component: string; held: number; attended: number; percent: number; short: boolean };
export type Absence = { on_date: string; period: number | null; subject_id: number | null; subject: string | null; component: string | null };
export type Correction = { id: number; student_id: number; student?: string; subject?: string | null; on_date: string; period: number | null; reason: string; status: string; decision_note: string | null; subject_id: number | null };

// Under each course: theory, practical, tutorial separately (the compiled figure is the course row).
export function PartsTable({ rows, names, minimum }: { rows: PartRow[]; names: Record<number, string>; minimum: number }) {
  const multi = rows.filter((r, _, a) => a.filter((x) => x.subject_id === r.subject_id).length > 1 || r.component !== "theory");
  if (!multi.length) return null;
  return (
    <Card>
      <CardHeader title="By part (theory, practical)" />
      <CardBody className="p-0">
        <table className="w-full text-[13px]"><tbody>{multi.map((r) => (
          <tr key={`${r.subject_id}-${r.component}`} className="border-t border-hair first:border-t-0">
            <td className="px-4 py-1.5">{names[r.subject_id] ?? ""}</td><td className="px-4 py-1.5 text-ink-700">{PART[r.component] ?? r.component}</td>
            <td className="px-4 py-1.5 text-right tabular">{r.attended} of {r.held}</td>
            <td className={`px-4 py-1.5 text-right tabular ${Number(r.percent) < minimum ? "text-down" : "text-up"}`}>{Number(r.percent)}%</td>
          </tr>))}</tbody></table>
      </CardBody>
    </Card>
  );
}

// The student's recent absences: "I was present" goes to the teacher; and the requests already sent.
export function MyCorrections({ studentId, absences, sent }: { studentId: number; absences: Absence[]; sent: Correction[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const key = (a: Absence) => `${a.on_date}|${a.period ?? ""}|${a.subject_id ?? ""}`;
  const waiting = new Set(sent.filter((c) => c.status === "pending").map((c) => `${c.on_date}|${c.period ?? ""}|${c.subject_id ?? ""}`));
  return (
    <Card>
      <CardHeader title="Absences in the last 15 days" />
      <CardBody className="space-y-2 text-[13px]">
        <Note m={msg} />
        {absences.length === 0 ? <p className="text-ink-500">No absences.</p> : <ul className="space-y-1.5">{absences.map((a) => (
          <li key={key(a)} className="flex flex-wrap items-center gap-2">
            <span className="tabular">{dmy(a.on_date)}{a.period ? ` · P${a.period}` : ""}</span><span>{a.subject ?? "Day"}{a.component && a.component !== "theory" ? ` (${PART[a.component]})` : ""}</span>
            {waiting.has(key(a)) ? <span className="text-ink-500">correction asked</span> : open === key(a) ? <>
              <Input className="h-8 w-72 text-[12px]" aria-label={`Why you were present on ${a.on_date}`} placeholder="What happened (you were present)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" disabled={pending || reason.trim().length < 3} onClick={() => start(async () => { const r = await requestCorrection({ studentId, date: a.on_date, period: a.period, subjectId: a.subject_id, reason }); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) { setOpen(null); setReason(""); router.refresh(); } })}>Send</Button></>
              : <button type="button" className="text-[12px] text-[#0F6CBD] hover:underline" onClick={() => { setOpen(key(a)); setReason(""); }}>I was present</button>}
          </li>))}</ul>}
        {sent.length > 0 && <div className="border-t border-hair pt-2"><p className="font-medium text-ink-900">Corrections asked</p>
          <ul className="mt-1 space-y-0.5">{sent.map((c) => <li key={c.id}>{dmy(c.on_date)}{c.period ? ` · P${c.period}` : ""} {c.subject ?? ""}: <span className={c.status === "accepted" ? "text-up" : c.status === "declined" ? "text-down" : "text-ink-500"}>{c.status === "pending" ? "waiting" : c.status}{c.decision_note ? ` (${c.decision_note})` : ""}</span></li>)}</ul></div>}
      </CardBody>
    </Card>
  );
}

// The teacher's inbox: corrections asked for their lectures.
export function CorrectionsInbox({ rows }: { rows: Correction[] }) {
  const [note, setNote] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader title={`Attendance corrections asked (${rows.length})`} />
      <CardBody className="space-y-2 text-[13px]">
        <Note m={msg} />
        {rows.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 border-t border-hair pt-2 first:border-0 first:pt-0">
            <b>{c.student}</b><span className="text-ink-500">{dmy(c.on_date)}{c.period ? ` · P${c.period}` : ""} {c.subject ?? ""}</span><span className="text-ink-700">“{c.reason}”</span>
            <Input className="h-8 w-48 text-[12px]" aria-label={`Note for ${c.student}`} placeholder="Note (needed to decline)" value={note[c.id] ?? ""} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} />
            <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await decideCorrection(c.id, true, note[c.id] ?? ""); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Mark present</Button>
            <Button size="sm" variant="ghost" disabled={pending || !(note[c.id] ?? "").trim()} onClick={() => start(async () => { const r = await decideCorrection(c.id, false, note[c.id] ?? ""); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Decline</Button>
          </div>))}
      </CardBody>
    </Card>
  );
}

// Set-up (colleges): parts of each subject, lab batches of the section, and who takes which part or batch.
export function PartsSetup({ sectionId, sectionLabel, subjects, roster, batches, allotments, staff, canSubjects }: {
  sectionId: number; sectionLabel: string; subjects: { id: number; name: string; parts: string[] }[]; roster: { id: number; name: string; roll: number | null }[];
  batches: { label: string; ids: number[] }[]; allotments: { id: number; staff: string; subject_id: number; component: string; batch: string | null }[]; staff: { id: number; name: string }[]; canSubjects: boolean }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [parts, setParts] = useState<Record<number, string[]>>(Object.fromEntries(subjects.map((s) => [s.id, s.parts])));
  const [labels, setLabels] = useState<string[]>(batches.length ? batches.map((b) => b.label) : ["B1", "B2"]);
  const [member, setMember] = useState<Record<number, string>>(Object.fromEntries(batches.flatMap((b) => b.ids.map((id) => [id, b.label]))));
  const [al, setAl] = useState({ staff: staff[0]?.id ?? 0, subject: subjects[0]?.id ?? 0, part: "practical", batch: "" });
  const done = (r: { ok: boolean; message?: string; error?: string }) => { setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error ?? "" }); router.refresh(); };
  return (
    <div className="space-y-4 text-[13px]">
      <Note m={msg} />
      {canSubjects && <Card>
        <CardHeader title="Parts of each subject" />
        <CardBody className="space-y-1.5">{subjects.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3"><span className="w-56">{s.name}</span>
            {["theory", "practical", "tutorial"].map((p) => <label key={p} className="flex items-center gap-1"><input type="checkbox" checked={parts[s.id]?.includes(p) ?? false}
              onChange={(e) => setParts({ ...parts, [s.id]: e.target.checked ? [...(parts[s.id] ?? []), p] : (parts[s.id] ?? []).filter((x) => x !== p) })} />{PART[p]}</label>)}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => done(await setSubjectParts(s.id, parts[s.id] ?? [])))}>Save</Button>
          </div>))}</CardBody>
      </Card>}
      <Card>
        <CardHeader title={`Lab batches of ${sectionLabel}`} />
        <CardBody className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">Batches:{labels.map((l, i) => <Input key={i} className="h-8 w-20" aria-label={`Batch ${i + 1} name`} value={l} onChange={(e) => setLabels(labels.map((x, j) => (j === i ? e.target.value : x)))} />)}
            <button type="button" className="text-[12px] text-[#0F6CBD] hover:underline" onClick={() => setLabels([...labels, `B${labels.length + 1}`])}>Add a batch</button></div>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{roster.map((r) => (
            <label key={r.id} className="flex items-center justify-between gap-2 rounded-sm border border-hair px-2 py-1"><span><span className="tabular">{r.roll ?? "-"}</span> {r.name}</span>
              <Select className="h-7 w-24 text-[12px]" aria-label={`Batch of ${r.name}`} value={member[r.id] ?? ""} onChange={(e) => setMember({ ...member, [r.id]: e.target.value })}>
                <option value="">None</option>{labels.filter(Boolean).map((l) => <option key={l} value={l}>{l}</option>)}</Select></label>))}</div>
          <Button size="sm" disabled={pending} onClick={() => start(async () => done(await saveBatches(sectionId, labels.filter(Boolean).map((l) => ({ label: l, students: roster.filter((r) => member[r.id] === l).map((r) => r.id) })))))}>Save batches</Button>
        </CardBody>
      </Card>
      {canSubjects && <Card>
        <CardHeader title="Who takes which part" />
        <CardBody className="space-y-2">
          {allotments.length > 0 && <ul className="space-y-0.5">{allotments.map((a) => <li key={a.id} className="flex items-center gap-2">{a.staff}: {subjects.find((s) => s.id === a.subject_id)?.name} · {PART[a.component]}{a.batch ? ` · batch ${a.batch}` : ""}
            <button type="button" className="text-[12px] text-ink-500 hover:text-down" onClick={() => start(async () => done(await removePartAllotment(a.id)))}>remove</button></li>)}</ul>}
          <div className="flex flex-wrap items-end gap-2">
            <Select className="h-8 w-44" aria-label="Teacher for the part" value={al.staff} onChange={(e) => setAl({ ...al, staff: Number(e.target.value) })}>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
            <Select className="h-8 w-44" aria-label="Subject for the part" value={al.subject} onChange={(e) => setAl({ ...al, subject: Number(e.target.value) })}>{subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
            <Select className="h-8 w-32" aria-label="Part" value={al.part} onChange={(e) => setAl({ ...al, part: e.target.value })}>{["theory", "practical", "tutorial"].map((p) => <option key={p} value={p}>{PART[p]}</option>)}</Select>
            <Select className="h-8 w-32" aria-label="Batch for the part" value={al.batch} onChange={(e) => setAl({ ...al, batch: e.target.value })}><option value="">Whole section</option>{labels.filter(Boolean).map((l) => <option key={l} value={l}>Batch {l}</option>)}</Select>
            <Button size="sm" disabled={pending || !al.staff || !al.subject} onClick={() => start(async () => done(await addPartAllotment({ staffId: al.staff, sectionId, subjectId: al.subject, component: al.part, batch: al.batch })))}>Assign</Button>
          </div>
        </CardBody>
      </Card>}
    </div>
  );
}
