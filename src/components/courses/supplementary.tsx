"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { createSupplementary, registerBacklogs, saveSuppMarks, publishSupplementary } from "@/app/dashboard/supplementary/actions";

export type SuppRow = { id: number; attempt: number; cia: number | null; cia_max: number | null; ese_marks: number | null; ese_max: number; is_absent: boolean; status: string;
  student: { full_name: string; admission_no: string }; course: { code: string; name: string }; result: { grade: string; passed: boolean } | null };

function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string; id?: number }>, after?: (id?: number) => void) => start(async () => {
    const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) { after?.(r.id); router.refresh(); }
  });
  return { msg, pending, run };
}
function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}
const n = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2));

export function NewSupplementary({ semesters }: { semesters: { id: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [sem, setSem] = useState(semesters[0]?.id ?? 0);
  const [name, setName] = useState("");
  const [fee, setFee] = useState("");
  const [closes, setCloses] = useState("");
  const { msg, pending, run } = useAct();
  const router = useRouter();
  if (!open) return <div className="flex items-center gap-3"><Button size="sm" variant="subtle" onClick={() => setOpen(true)}>New supplementary exam</Button><Msg m={msg} /></div>;
  return (
    <Card>
      <CardHeader title="New supplementary exam" action={<Msg m={msg} />} />
      <CardBody className="flex flex-wrap items-end gap-2">
        <Select className="h-9 text-[13px]" aria-label="For semester" value={sem} onChange={(e) => setSem(Number(e.target.value))}>{semesters.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
        <Input className="h-9 w-64 text-[13px]" aria-label="Exam name" placeholder="Name, for example Supplementary May 2027" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="text-[12px] text-ink-700">Fee per course, Rs (optional)<Input className="mt-0.5 h-9 w-28 text-[13px]" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
        <label className="text-[12px] text-ink-700">Fee due by<Input type="date" className="mt-0.5 h-9 text-[13px]" value={closes} onChange={(e) => setCloses(e.target.value)} /></label>
        <Button disabled={pending} onClick={() => run(() => createSupplementary({ semesterId: sem, name, fee, closes }), (id) => { setOpen(false); if (id) router.push(`?session=${id}`); })}>Create</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </CardBody>
    </Card>
  );
}

export function SupplementaryDesk({ sessionId, name, semester, fee, rows, openBacklogs, canPublish }: {
  sessionId: number; name: string; semester: string; fee: number | null; rows: SuppRow[]; openBacklogs: number; canPublish: boolean;
}) {
  const [marks, setMarks] = useState<Record<number, { marks: string; absent: boolean }>>(
    Object.fromEntries(rows.map((r) => [r.id, { marks: r.ese_marks == null ? "" : String(Number(r.ese_marks)), absent: r.is_absent }])));
  const { msg, pending, run } = useAct();
  const waiting = rows.filter((r) => r.status === "registered");
  const dirty = waiting.filter((r) => { const m = marks[r.id]; return m && (m.absent !== r.is_absent || m.marks !== (r.ese_marks == null ? "" : String(Number(r.ese_marks)))); });
  return (
    <Card>
      <CardHeader title={`${name}: ${semester}`} action={
        <div className="flex flex-wrap items-center gap-2">
          <Msg m={msg} />
          <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => registerBacklogs(sessionId))}>Register all backlogs</Button>
          {dirty.length > 0 && <Button size="sm" disabled={pending} onClick={() => run(() => saveSuppMarks(dirty.map((r) => ({ id: r.id, ...marks[r.id] }))))}>Save marks ({dirty.length})</Button>}
          {canPublish && waiting.length > 0 && <Button size="sm" disabled={pending || dirty.length > 0} onClick={() => run(() => publishSupplementary(sessionId))}>Publish results</Button>}
        </div>} />
      <CardBody className="p-0">
        <p className="px-4 py-2 text-[12px] text-ink-500">
          {openBacklogs} open backlog{openBacklogs === 1 ? "" : "s"} in this semester; {rows.length} registered{fee ? `, fee Rs ${n(fee)} per course (an invoice per student)` : ""}.
          {!canPublish && " Results are published by the Controller of Examinations."}
        </p>
        {rows.length === 0 ? <p className="px-4 pb-3 text-[13px] text-ink-500">Nobody registered yet. Register all backlogs to start.</p> : (
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Course</th><th className="px-4 py-2 font-medium">Student</th><th className="px-4 py-2 font-medium">Attempt</th>
              <th className="px-4 py-2 text-right font-medium">Internal (kept)</th><th className="px-4 py-2 font-medium">End-semester marks</th><th className="px-4 py-2 font-medium">Result</th></tr></thead>
            <tbody>{rows.map((r) => {
              const m = marks[r.id] ?? { marks: "", absent: false };
              return (
                <tr key={r.id} className="border-t border-hair">
                  <td className="px-4 py-1.5"><b>{r.course.code}</b> {r.course.name}</td>
                  <td className="px-4 py-1.5">{r.student.full_name} <span className="text-ink-500">{r.student.admission_no}</span></td>
                  <td className="px-4 py-1.5 tabular">{r.attempt}</td>
                  <td className="px-4 py-1.5 text-right tabular">{n(r.cia)}/{n(r.cia_max)}</td>
                  <td className="px-4 py-1.5">{r.status === "published" ? <span className="tabular">{r.is_absent ? "Absent" : `${n(r.ese_marks)}/${n(r.ese_max)}`}</span> : (
                    <span className="inline-flex items-center gap-2">
                      <Input className="h-8 w-20 text-right text-[13px]" aria-label={`Marks for ${r.student.full_name}, ${r.course.code}`} disabled={m.absent} value={m.marks}
                        onChange={(e) => setMarks({ ...marks, [r.id]: { ...m, marks: e.target.value } })} /><span className="text-ink-500">/ {n(r.ese_max)}</span>
                      <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={m.absent} onChange={(e) => setMarks({ ...marks, [r.id]: { ...m, absent: e.target.checked } })} aria-label={`Absent: ${r.student.full_name}, ${r.course.code}`} />Absent</label>
                    </span>)}</td>
                  <td className={`px-4 py-1.5 ${r.result ? (r.result.passed ? "text-up" : "text-down") : "text-ink-500"}`}>{r.result ? (r.result.passed ? `Passed, ${r.result.grade}` : r.result.grade === "Ab" ? "Absent" : "Not passed") : "Waiting"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

// A student's (or parent's) view: open backlogs and supplementary outcomes.
export function MyBacklogs({ backlogs, attempts }: { backlogs: { course_code: string; course_name: string; semester_no: number | null; attempts: number; last_grade: string }[];
  attempts: { code: string; name: string; attempt: number; grade: string; passed: boolean }[] }) {
  if (!backlogs.length && !attempts.length) return null;
  return (
    <Card>
      <CardHeader title={backlogs.length ? `Backlogs (${backlogs.length})` : "Supplementary results"} />
      <CardBody className="space-y-2 text-[13px]">
        {backlogs.map((b) => <p key={b.course_code} className="text-down"><b>{b.course_code}</b> {b.course_name}{b.semester_no ? `, semester ${b.semester_no}` : ""}: {b.last_grade === "Ab" ? "absent" : "not passed"} after {b.attempts} attempt{b.attempts > 1 ? "s" : ""}</p>)}
        {attempts.map((a) => <p key={`${a.code}-${a.attempt}`} className={a.passed ? "text-up" : "text-ink-700"}><b>{a.code}</b> {a.name}: attempt {a.attempt}, {a.passed ? `passed with ${a.grade}` : a.grade === "Ab" ? "absent" : "not passed"}</p>)}
      </CardBody>
    </Card>
  );
}
