"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { downloadPdf, downloadPdfBook } from "@/lib/pdf";
import { admitCardPdf } from "@/components/exams/admit-pdf";
import { saveSession, publishSession, deleteSession, savePaper, deletePaper, admitCards } from "@/app/dashboard/exam-timetable/actions";

export type SessionView = { id: number; name: string; term: number; assessment_type_id: number; instructions: string | null; withhold_fee_dues: boolean; published_at: string | null };
export type PaperView = { id: number; session_id: number; class_id: number; subject_id: number; exam_date: string; starts_at: string; ends_at: string; max_marks: number; note: string | null; component?: string; optional_group?: string | null; subject: { name: string } | null };
type Opt = { id: number; name: string };

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const hm = (t: string) => t.slice(0, 5);

function SessionForm({ s, types, onSaved }: { s: SessionView | null; types: Opt[]; onSaved: (id?: number) => void }) {
  const uid = useId();
  const [name, setName] = useState(s?.name ?? "");
  const [term, setTerm] = useState(s?.term ?? 1);
  const [typeId, setTypeId] = useState(s?.assessment_type_id ?? types[0]?.id ?? 0);
  const [instructions, setInstructions] = useState(s?.instructions ?? "");
  const [withhold, setWithhold] = useState(s?.withhold_fee_dues ?? false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Exam name" htmlFor={`${uid}-n`}><Input id={`${uid}-n`} value={name} placeholder="Half-Yearly Examination" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Term" htmlFor={`${uid}-t`}><Select id={`${uid}-t`} value={term} onChange={(e) => setTerm(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Term {n}</option>)}</Select></Field>
        <Field label="Exam type" htmlFor={`${uid}-y`}><Select id={`${uid}-y`} value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      </div>
      <Field label="Instructions on the admit card (optional)" htmlFor={`${uid}-i`}><Textarea id={`${uid}-i`} rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={withhold} onChange={(e) => setWithhold(e.target.checked)} className="h-4 w-4 accent-[#0F6CBD]" />
        Hold back admit cards of students with fees overdue before the first paper</label>
      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={() => start(async () => { const r = await saveSession({ id: s?.id, name, term, typeId, instructions, withhold }); setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error }); if (r.ok) onSaved(r.id); })}>{s ? "Save exam" : "Create exam"}</Button>
        <Msg m={msg} />
      </div>
    </div>
  );
}

export function ExamsDesk({ canEdit, sessions, sessionId, papers, types, classes, subjects, sections, school, verifyBase }: {
  canEdit: boolean; sessions: SessionView[]; sessionId: number | null; papers: PaperView[]; types: Opt[];
  classes: { id: number; name: string; subjects: number[] }[]; subjects: Opt[]; sections: { id: number; label: string; classId: number }[]; school: string; verifyBase: string;
}) {
  const uid = useId();
  const router = useRouter();
  const s = sessions.find((x) => x.id === sessionId) ?? null;
  const [creating, setCreating] = useState(sessions.length === 0);
  const [editing, setEditing] = useState(false);
  const [classId, setClassId] = useState(classes[0]?.id ?? 0);
  const blankPaper = { id: null as number | null, subjectId: 0, date: "", start: "09:00", end: "12:00", max: "80", note: "", component: "Theory", group: "" };
  const [paper, setPaper] = useState(blankPaper);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? 0);
  const [withheld, setWithheld] = useState<{ name: string; reason: string }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); router.refresh(); });
  const classPapers = papers.filter((p) => p.class_id === classId);
  const subjOpts = subjects.filter((x) => (classes.find((c) => c.id === classId)?.subjects ?? []).includes(x.id));

  const printAdmit = () => start(async () => {
    if (!s) return;
    const sec = sections.find((x) => x.id === sectionId);
    if (!sec) return;
    const r = await admitCards(s.id, sec.id);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    const mine = papers.filter((p) => p.class_id === sec.classId).map((p) => ({ date: p.exam_date, start: p.starts_at, end: p.ends_at, subject: p.subject?.name ?? "", note: p.note }));
    if (!mine.length) { setMsg({ ok: false, text: `No papers are set for ${sec.label} in this exam.` }); return; }
    const ok = r.rows.filter((x) => !x.withheld);
    setWithheld(r.rows.filter((x) => x.withheld).map((x) => ({ name: x.student_name, reason: x.reason ?? "" })));
    if (!ok.length) { setMsg({ ok: false, text: "Every admit card in this section is held back." }); return; }
    await downloadPdfBook(ok.map((x) => admitCardPdf({ exam: s.name, school, student: x.student_name, admissionNo: x.admission_no, roll: x.roll_no, classLabel: x.class_label, instructions: s.instructions, papers: mine, verifyUrl: verifyBase + x.verify_token })), `Admit cards ${sec.label} ${s.name}`);
    setMsg({ ok: true, text: `${ok.length} admit cards downloaded.` });
  });

  return (
    <div className="space-y-4">
      {canEdit && (creating || editing || !s) && (
        <Card>
          <CardHeader title={editing && s ? `Edit ${s.name}` : "New exam"} action={s && <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setEditing(false); }}>Close</Button>} />
          <CardBody><SessionForm s={editing ? s : null} types={types} onSaved={(id) => { setCreating(false); setEditing(false); router.push(`/dashboard/exam-timetable?exam=${id}`); router.refresh(); }} /></CardBody>
        </Card>
      )}
      {s && (
        <Card>
          <CardHeader title={s.name} action={
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[12px] ${s.published_at ? "text-up" : "text-ink-500"}`}>{s.published_at ? "Published" : "Draft: families cannot see it"}</span>
              {canEdit && <>
                <Button size="sm" variant={s.published_at ? "ghost" : "primary"} disabled={pending} onClick={() => run(() => publishSession(s.id, !s.published_at))}>{s.published_at ? "Hide" : "Publish"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>New exam</Button>
                {confirm === `s${s.id}`
                  ? <Button size="sm" variant="danger" disabled={pending} onClick={() => { setConfirm(null); run(() => deleteSession(s.id)); }}>Remove this exam and its papers</Button>
                  : <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(`s${s.id}`)}>Remove</Button>}
              </>}
            </div>} />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Class">
              {classes.map((c) => (
                <button key={c.id} role="tab" aria-selected={c.id === classId} onClick={() => { setClassId(c.id); setPaper(blankPaper); }}
                  className={`rounded-sm border px-2.5 py-1 text-[13px] ${c.id === classId ? "border-[#0F6CBD] bg-[#EBF3FC] text-[#0F6CBD]" : "border-hair bg-white text-ink-700"}`}>
                  {c.name}<span className="ml-1 text-[11px] text-ink-500">{papers.filter((p) => p.class_id === c.id).length || ""}</span></button>
              ))}
            </div>
            <table className="w-full text-[13px]">
              <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 font-medium">Subject</th><th className="px-3 py-2 font-medium">Paper</th><th className="px-3 py-2 text-right font-medium">Max</th><th className="px-3 py-2 font-medium">Note</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {classPapers.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-ink-500">No papers for this class yet.</td></tr>}
                {classPapers.map((p) => (
                  <tr key={p.id} className="border-t border-hair">
                    <td className="px-3 py-2 tabular">{dmy(p.exam_date)}</td><td className="px-3 py-2 tabular">{hm(p.starts_at)} to {hm(p.ends_at)}</td>
                    <td className="px-3 py-2">{p.subject?.name}</td><td className="px-3 py-2">{p.component ?? "Theory"}{p.optional_group ? <span className="ml-1 text-[11px] text-ink-500">(option: {p.optional_group})</span> : null}</td>
                    <td className="px-3 py-2 text-right tabular">{Number(p.max_marks)}</td><td className="px-3 py-2">{p.note}</td>
                    {canEdit && <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setPaper({ id: p.id, subjectId: p.subject_id, date: p.exam_date, start: hm(p.starts_at), end: hm(p.ends_at), max: String(Number(p.max_marks)), note: p.note ?? "", component: p.component ?? "Theory", group: p.optional_group ?? "" })}>Edit</Button>
                      {confirm === `p${p.id}`
                        ? <Button size="sm" variant="danger" disabled={pending} onClick={() => { setConfirm(null); run(() => deletePaper(p.id)); }}>Remove</Button>
                        : <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(`p${p.id}`)}>Remove</Button>}
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && (
              <div className="grid items-end gap-2 border-t border-hair pt-3 sm:grid-cols-4 xl:grid-cols-9">
                <Field label="Subject" htmlFor={`${uid}-s`}><Select id={`${uid}-s`} value={paper.subjectId || ""} disabled={!!paper.id} onChange={(e) => setPaper({ ...paper, subjectId: Number(e.target.value) })}>
                  <option value="">Choose</option>{subjOpts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
                <Field label="Date" htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" value={paper.date} onChange={(e) => setPaper({ ...paper, date: e.target.value })} /></Field>
                <Field label="Starts" htmlFor={`${uid}-a`}><Input id={`${uid}-a`} type="time" value={paper.start} onChange={(e) => setPaper({ ...paper, start: e.target.value })} /></Field>
                <Field label="Ends" htmlFor={`${uid}-b`}><Input id={`${uid}-b`} type="time" value={paper.end} onChange={(e) => setPaper({ ...paper, end: e.target.value })} /></Field>
                <Field label="Max marks" htmlFor={`${uid}-m`}><Input id={`${uid}-m`} inputMode="decimal" value={paper.max} onChange={(e) => setPaper({ ...paper, max: e.target.value })} /></Field>
                <Field label="Paper" htmlFor={`${uid}-c`}><Select id={`${uid}-c`} value={paper.component} onChange={(e) => setPaper({ ...paper, component: e.target.value })}>
                  {["Theory", "Practical", "Oral", "Project"].map((x) => <option key={x}>{x}</option>)}</Select></Field>
                <Field label="Optional group" htmlFor={`${uid}-g`}><Input id={`${uid}-g`} value={paper.group} placeholder="e.g. Language" onChange={(e) => setPaper({ ...paper, group: e.target.value })} /></Field>
                <Field label="Note (optional)" htmlFor={`${uid}-o`}><Input id={`${uid}-o`} value={paper.note} onChange={(e) => setPaper({ ...paper, note: e.target.value })} /></Field>
                <Button disabled={pending || !paper.subjectId} onClick={() => run(async () => {
                  const r = await savePaper({ id: paper.id, sessionId: s.id, classId, subjectId: paper.subjectId, date: paper.date, start: paper.start, end: paper.end, max: paper.max, note: paper.note, component: paper.component, group: paper.group });
                  if (r.ok) setPaper({ ...blankPaper, date: paper.date, start: paper.start, end: paper.end, max: paper.max });
                  return r;
                })}>{paper.id ? "Save paper" : "Add paper"}</Button>
              </div>
            )}
            <Msg m={msg} />
          </CardBody>
        </Card>
      )}
      {s && sections.length > 0 && (
        <Card>
          <CardHeader title="Admit cards" />
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select className="h-9 w-40 text-[13px]" aria-label="Section for admit cards" value={sectionId} onChange={(e) => setSectionId(Number(e.target.value))}>
                {sections.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
              <Button size="sm" variant="subtle" disabled={pending} onClick={printAdmit}>Download admit cards</Button>
              {s.withhold_fee_dues && <span className="text-[12px] text-ink-500">Students with overdue fees are held back.</span>}
            </div>
            {withheld.length > 0 && (
              <div className="rounded-sm border border-hair p-2 text-[12px]">
                <p className="font-medium text-down">Held back ({withheld.length})</p>
                <ul>{withheld.map((w) => <li key={w.name}>{w.name}: {w.reason}</li>)}</ul>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export function FamilyExams({ sessions, papers, children, school, verifyBase }: {
  sessions: SessionView[]; papers: PaperView[]; children: { id: number; name: string; sectionId: number; classId: number }[]; school: string; verifyBase: string;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {children.map((k) => sessions.map((s) => {
        const mine = papers.filter((p) => p.session_id === s.id && p.class_id === k.classId);
        if (!mine.length) return null;
        return (
          <Card key={`${k.id}-${s.id}`}>
            <CardHeader title={`${s.name}: ${k.name}`} action={
              <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => {
                setMsg(null);
                const r = await admitCards(s.id, k.sectionId, k.id);
                if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
                const row = r.rows[0];
                if (!row) { setMsg({ ok: false, text: "No admit card is available yet." }); return; }
                if (row.withheld) { setMsg({ ok: false, text: `The admit card is held back: ${row.reason}. Please contact the school office.` }); return; }
                await downloadPdf(admitCardPdf({ exam: s.name, school, student: row.student_name, admissionNo: row.admission_no, roll: row.roll_no, classLabel: row.class_label, instructions: s.instructions,
                  papers: mine.map((p) => ({ date: p.exam_date, start: p.starts_at, end: p.ends_at, subject: p.subject?.name ?? "", note: p.note })), verifyUrl: verifyBase + row.verify_token }));
              })}>Download admit card</Button>} />
            <CardBody className="p-0">
              <table className="w-full text-[13px]">
                <tbody>{mine.map((p) => (
                  <tr key={p.id} className="border-t border-hair first:border-t-0">
                    <td className="px-4 py-2 tabular">{dmy(p.exam_date)}</td><td className="px-4 py-2 tabular">{hm(p.starts_at)} to {hm(p.ends_at)}</td><td className="px-4 py-2">{p.subject?.name}</td>
                  </tr>))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        );
      }))}
      <Msg m={msg} />
    </div>
  );
}
