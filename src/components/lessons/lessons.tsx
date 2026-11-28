"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { saveSyllabus, logLesson, signLessonUpload, addLessonFile, removeMaterial, materialLink } from "@/app/dashboard/lessons/actions";

export type FeedRow = { id: number; on_date: string; period: number | null; teacher: string | null; topics: { id: number; title: string; unit: string }[]; summary: string | null;
  materials: { id: number; title: string; url: string | null; file: boolean }[]; attended: string | null; course_wide: boolean };
export type ProgressRow = { unit_id: number; unit: string; unit_seq: number; topic_id: number | null; topic: string | null; topic_seq: number | null; covered_on: string | null };
type Msg = { ok: boolean; text: string } | null;
const dmy = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p> : null);
const ATT: Record<string, [string, string]> = { present: ["Present", "text-up"], absent: ["Absent", "text-down"], late: ["Late", "text-ink-700"], half_day: ["Half day", "text-ink-700"], excused: ["Excused", "text-ink-700"] };

function units(rows: ProgressRow[]) {
  const m = new Map<number, { title: string; topics: { id: number; title: string; covered: string | null }[] }>();
  for (const r of rows) {
    if (!m.has(r.unit_id)) m.set(r.unit_id, { title: r.unit, topics: [] });
    if (r.topic_id) m.get(r.unit_id)!.topics.push({ id: r.topic_id, title: r.topic ?? "", covered: r.covered_on });
  }
  return [...m.values()];
}

// Syllabus coverage: each unit with its topics, ticked when a lesson covered them.
export function Progress({ rows }: { rows: ProgressRow[] }) {
  const us = units(rows);
  const all = us.flatMap((u) => u.topics), done = all.filter((t) => t.covered).length;
  if (!us.length) return <p className="text-[13px] text-ink-500">The syllabus for this subject has not been added yet.</p>;
  return (
    <div className="space-y-3 text-[13px]">
      <div>
        <div className="flex justify-between text-ink-700"><span>Syllabus covered</span><span className="tabular">{done} of {all.length} topics{all.length ? ` (${Math.round((done / all.length) * 100)}%)` : ""}</span></div>
        <div className="mt-1 h-2 rounded-full bg-[#eee]"><div className="h-2 rounded-full bg-ink-900" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} /></div>
      </div>
      {us.map((u, i) => (
        <div key={i}>
          <p className="font-medium text-ink-900">{u.title} <span className="font-normal text-ink-500">({u.topics.filter((t) => t.covered).length}/{u.topics.length})</span></p>
          <ul className="mt-1 space-y-0.5">{u.topics.map((t) => (
            <li key={t.id} className={t.covered ? "text-ink-900" : "text-ink-500"}>{t.covered ? "✓" : "○"} {t.title}{t.covered ? <span className="text-ink-500"> · {dmy(t.covered)}</span> : null}</li>))}</ul>
        </div>))}
    </div>
  );
}

// The lessons of a subject, newest first: what was taught, the material shared, and (for a student) attendance.
export function Feed({ rows, canEdit, showAttendance }: { rows: FeedRow[]; canEdit: boolean; showAttendance: boolean }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!rows.length) return <p className="text-[13px] text-ink-500">No lessons logged yet.</p>;
  const upload = (lessonId: number, f: File) => start(async () => {
    const s = await signLessonUpload(lessonId, f.type, f.size);
    if (!s.ok) { setMsg({ ok: false, text: s.error }); return; }
    const put = await fetch(s.uploadUrl, { method: "PUT", body: f, headers: { "Content-Type": f.type } });
    if (!put.ok) { setMsg({ ok: false, text: "The upload failed. Try again." }); return; }
    const r = await addLessonFile(lessonId, f.name.replace(/\.[^.]+$/, "").slice(0, 160), s.key);
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh();
  });
  return (
    <div className="space-y-2">
      <Note m={msg} />
      <ol className="space-y-2">{rows.map((l) => (
        <li key={l.id} className="rounded-sm border border-hair bg-white p-3 text-[13px]">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium text-ink-900">{dmy(l.on_date)}{l.period ? ` · Period ${l.period}` : ""}</span>
            {l.teacher && <span className="text-ink-500">{l.teacher}</span>}
            {l.course_wide && <span className="text-ink-500">all sections</span>}
            {showAttendance && l.attended && <span className={`ml-auto ${ATT[l.attended]?.[1] ?? "text-ink-700"}`}>{ATT[l.attended]?.[0] ?? l.attended}</span>}
          </div>
          {l.topics.length > 0 && <p className="mt-1 text-ink-900">{l.topics.map((t) => t.title).join(" · ")} <span className="text-ink-500">({[...new Set(l.topics.map((t) => t.unit))].join(", ")})</span></p>}
          {l.summary && <p className="mt-1 whitespace-pre-line text-ink-700">{l.summary}</p>}
          {(l.materials.length > 0 || canEdit) && <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {l.materials.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1 rounded-sm bg-[#f5f5f5] px-1.5 py-0.5">
                {m.url ? <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-[#0F6CBD] hover:underline">{m.title}</a>
                  : <button type="button" className="text-[#0F6CBD] hover:underline" onClick={() => { const w = window.open("about:blank", "_blank"); start(async () => { const r = await materialLink(m.id); if (r.ok && w) { w.opener = null; w.location.href = r.url; } else { w?.close(); setMsg({ ok: false, text: r.ok ? "Allow pop-ups to open the file." : r.error }); } }); }}>{m.title}</button>}
                {canEdit && <button type="button" aria-label={`Remove ${m.title}`} className="text-ink-500 hover:text-down" disabled={pending} onClick={() => start(async () => { const r = await removeMaterial(m.id); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh(); })}>×</button>}
              </span>))}
            {canEdit && <label className="cursor-pointer text-[12px] text-[#0F6CBD] hover:underline">Add a file
              <input type="file" className="sr-only" aria-label={`File for the lesson of ${l.on_date}`} accept=".pdf,.docx,.pptx,.xlsx,.jpg,.jpeg,.png" disabled={pending}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(l.id, f); }} /></label>}
          </div>}
        </li>))}</ol>
    </div>
  );
}

// The teacher: log a lesson (topics from the syllabus, a note, links) and keep the syllabus.
export function TeacherLessons({ sectionId, subjectId, classId, progress, today }: { sectionId: number | null; subjectId: number; classId: number | null; progress: ProgressRow[]; today: string }) {
  const us = useMemo(() => units(progress), [progress]);
  const [f, setF] = useState({ date: today, period: "", summary: "" });
  const [picked, setPicked] = useState<number[]>([]);
  const [links, setLinks] = useState([{ title: "", url: "" }]);
  const [editing, setEditing] = useState(us.length === 0);
  const [draft, setDraft] = useState(us.length ? us.map((u) => ({ title: u.title, topics: u.topics.map((t) => t.title).join("\n") })) : [{ title: "", topics: "" }]);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-4">
      <Note m={msg} />
      <Card>
        <CardHeader title="Log a lesson" />
        <CardBody className="space-y-3 text-[13px]">
          <div className="flex flex-wrap gap-3">
            <label>Date<Input type="date" className="mt-1 h-8" aria-label="Lesson date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label>Period (optional)<Input className="mt-1 h-8 w-20" inputMode="numeric" aria-label="Period" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></label>
          </div>
          {us.length > 0 ? <div className="space-y-2">{us.map((u, i) => (
            <fieldset key={i}><legend className="font-medium text-ink-900">{u.title}</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{u.topics.map((t) => (
                <label key={t.id} className={`flex items-center gap-1.5 ${t.covered ? "text-ink-500" : "text-ink-900"}`}>
                  <input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} />{t.title}{t.covered ? " ✓" : ""}</label>))}</div>
            </fieldset>))}</div> : <p className="text-ink-500">Add the syllabus below to pick topics; until then, describe the lesson.</p>}
          <label className="block">What was taught<Textarea className="mt-1" rows={3} aria-label="What was taught" placeholder="For example: worked through examples 3 to 7; homework is exercise 2.1" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
          <div className="space-y-1.5">{links.map((l, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <Input className="h-8 w-48" aria-label={`Link title ${i + 1}`} placeholder="Link title (optional)" value={l.title} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <Input className="h-8 flex-1" aria-label={`Link ${i + 1}`} placeholder="https://… (video, slides, reading)" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            </div>))}
            <button type="button" className="text-[12px] text-[#0F6CBD] hover:underline" onClick={() => setLinks([...links, { title: "", url: "" }])}>Add another link</button></div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={pending} onClick={() => start(async () => {
              const r = await logLesson({ sectionId, subjectId, date: f.date, period: f.period.trim() ? Number(f.period) : null, topics: picked, summary: f.summary, links });
              setMsg(r.ok ? { ok: true, text: `${r.message} Add files to it in the list below.` } : { ok: false, text: r.error });
              if (r.ok) { setPicked([]); setF({ ...f, summary: "" }); setLinks([{ title: "", url: "" }]); router.refresh(); }
            })}>Save the lesson</Button>
            <span className="text-[12px] text-ink-500">Saving the same date and period again updates that lesson.</span>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Syllabus" action={!editing ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button> : undefined} />
        <CardBody className="space-y-3 text-[13px]">
          {!editing ? <Progress rows={progress} /> : <>
            <p className="text-ink-500">Each unit with its topics, one per line. Topics keep their place, so lessons already logged keep them.</p>
            {draft.map((u, i) => (
              <div key={i} className="space-y-1 rounded-sm border border-hair p-2">
                <Input className="h-8" aria-label={`Unit ${i + 1} title`} placeholder={`Unit ${i + 1} title`} value={u.title} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <Textarea rows={4} aria-label={`Unit ${i + 1} topics`} placeholder="One topic per line" value={u.topics} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, topics: e.target.value } : x)))} />
              </div>))}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft([...draft, { title: "", topics: "" }])}>Add a unit</Button>
              <Button size="sm" disabled={pending} onClick={() => start(async () => {
                const r = await saveSyllabus(subjectId, classId, draft.filter((u) => u.title.trim()).map((u) => ({ title: u.title.trim(), topics: u.topics.split("\n").map((t) => t.trim()).filter(Boolean) })));
                setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) { setEditing(false); router.refresh(); }
              })}>Save the syllabus</Button>
            </div></>}
        </CardBody>
      </Card>
    </div>
  );
}
