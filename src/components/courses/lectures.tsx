"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { markLecture, markCourseLecture } from "@/app/dashboard/lectures/actions";
import { askRelaxation } from "@/app/dashboard/relaxations/actions";
import { AskButton } from "@/components/courses/relaxations";

export type AttRow = { student_id: number; student_name: string; subject_id: number; subject: string; held: number; attended: number; percent: number; short: boolean; condoned: boolean };
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}

export function LectureMarker({ sectionId, subjects, roster, lockNote, electiveSubject }: { sectionId: number; subjects: { id: number; name: string }[]; roster: { id: number; name: string; roll: number | null; section?: string }[]; lockNote: string | null; electiveSubject?: number }) {
  const uid = useId();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? 0);
  const [date, setDate] = useState(todayIST());
  const [period, setPeriod] = useState("1");
  const [absent, setAbsent] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [locked, setLocked] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toggle = (id: number) => setAbsent((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Card>
      <CardHeader title="Mark a lecture" action={<Msg m={msg} />} />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Course" htmlFor={`${uid}-s`}><Select id={`${uid}-s`} value={subjectId} onChange={(e) => setSubjectId(Number(e.target.value))}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Date" htmlFor={`${uid}-d`}><Input id={`${uid}-d`} type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Period" htmlFor={`${uid}-p`}><Select id={`${uid}-p`} value={period} onChange={(e) => setPeriod(e.target.value)}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select></Field>
          <span className="pb-2 text-[12px] text-ink-500">Everyone is present unless tapped absent.</span>
        </div>
        {lockNote && <p className="text-[12px] text-ink-500">{lockNote}</p>}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-6">
          {roster.map((r) => (
            <button key={r.id} aria-pressed={absent.has(r.id)} aria-label={`${r.name}: absent`} onClick={() => toggle(r.id)}
              className={`rounded-sm border px-2 py-1.5 text-left text-[12px] ${absent.has(r.id) ? "border-down bg-down text-white" : "border-hair bg-white text-ink-900"}`}>
              <span className="tabular">{r.roll ?? "-"}</span> {r.name}{r.section ? <span className="ml-1 text-[10px] opacity-70">{r.section}</span> : null}</button>
          ))}
        </div>
        <Button disabled={pending || !subjectId} onClick={() => start(async () => {
          const res = electiveSubject ? await markCourseLecture({ subjectId: electiveSubject, date, period: Number(period), absent: [...absent] })
            : await markLecture({ sectionId, subjectId, date, period: Number(period), absent: [...absent] });
          setMsg(res.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: res.error });
          setLocked(!res.ok && /lock|frozen/i.test(res.error));
          if (res.ok) { setAbsent(new Set()); router.refresh(); }
        })}>{pending ? "Saving…" : `Save lecture (${absent.size} absent)`}</Button>
        {locked && <AskButton key={`${subjectId}-${date}`} label="Ask to unlock this day" ariaLabel="Reason to unlock" send={(reason) => askRelaxation({ kind: "unlock", sectionId, subjectId, date, reason })} />}
      </CardBody>
    </Card>
  );
}

export function AttendanceShortage({ rows, minimum, waiting }: { rows: AttRow[]; minimum: number; waiting: string[] }) {
  const short = rows.filter((r) => r.short);
  return (
    <Card>
      <CardHeader title={`Below ${minimum}% (${short.filter((r) => !r.condoned).length})`} action={<span className="text-[12px] text-ink-500">{rows.length ? `${new Set(rows.map((r) => r.student_id)).size} students, ${new Set(rows.map((r) => r.subject_id)).size} courses marked` : "No lectures marked yet"}</span>} />
      <CardBody className="p-0">
        {short.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">Nobody is short.</p> : (
          <table className="w-full text-[13px]"><tbody>{short.map((r) => (
            <tr key={`${r.student_id}-${r.subject_id}`} className="border-t border-hair first:border-t-0">
              <td className="px-4 py-1.5 font-medium">{r.student_name}</td><td className="px-4 py-1.5">{r.subject}</td>
              <td className="px-4 py-1.5 text-right tabular">{r.attended}/{r.held}</td><td className="px-4 py-1.5 text-right tabular text-down">{Number(r.percent)}%</td>
              <td className="px-4 py-1.5">{r.condoned ? <span className="text-up">Relaxed</span> : waiting.includes(`${r.student_id}-${r.subject_id}`) ? <span className="text-ink-500">Waiting for approval</span> : <AskButton label="Ask to relax" ariaLabel={`Reason for ${r.student_name}`} send={(reason) => askRelaxation({ kind: "attendance", studentId: r.student_id, subjectId: r.subject_id, reason })} />}</td>
            </tr>))}</tbody></table>
        )}
      </CardBody>
    </Card>
  );
}

export function MyAttendance({ rows, minimum, waiting = [] }: { rows: AttRow[]; minimum: number; waiting?: string[] }) {
  if (!rows.length) return <p className="text-[13px] text-ink-500">No lectures have been marked yet this semester.</p>;
  return (
    <Card>
      <CardBody className="p-0">
        <table className="w-full text-[13px]"><tbody>{rows.map((r) => (
          <tr key={r.subject_id} className="border-t border-hair first:border-t-0">
            <td className="px-4 py-2 font-medium">{r.subject}</td><td className="px-4 py-2 text-right tabular">{r.attended} of {r.held}</td>
            <td className={`px-4 py-2 text-right tabular ${r.short && !r.condoned ? "text-down" : "text-up"}`}>{Number(r.percent)}%</td>
            <td className="px-4 py-2 text-[12px] text-ink-500">{r.short ? (r.condoned ? "relaxed" : waiting.includes(`${r.student_id}-${r.subject_id}`) ? "relaxation under consideration" : `below ${minimum}%: the hall ticket is held. Speak to your class teacher.`) : ""}</td>
          </tr>))}</tbody></table>
      </CardBody>
    </Card>
  );
}
