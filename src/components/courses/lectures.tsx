"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { markLecture, condone } from "@/app/dashboard/lectures/actions";

export type AttRow = { student_id: number; student_name: string; subject_id: number; subject: string; held: number; attended: number; percent: number; short: boolean; condoned: boolean };
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}

export function LectureMarker({ sectionId, subjects, roster }: { sectionId: number; subjects: { id: number; name: string }[]; roster: { id: number; name: string; roll: number | null }[] }) {
  const uid = useId();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? 0);
  const [date, setDate] = useState(todayIST());
  const [period, setPeriod] = useState("1");
  const [absent, setAbsent] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-6">
          {roster.map((r) => (
            <button key={r.id} aria-pressed={absent.has(r.id)} aria-label={`${r.name}: absent`} onClick={() => toggle(r.id)}
              className={`rounded-sm border px-2 py-1.5 text-left text-[12px] ${absent.has(r.id) ? "border-down bg-down text-white" : "border-hair bg-white text-ink-900"}`}>
              <span className="tabular">{r.roll ?? "-"}</span> {r.name}</button>
          ))}
        </div>
        <Button disabled={pending || !subjectId} onClick={() => start(async () => {
          const res = await markLecture({ sectionId, subjectId, date, period: Number(period), absent: [...absent] });
          setMsg(res.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: res.error });
          if (res.ok) { setAbsent(new Set()); router.refresh(); }
        })}>{pending ? "Saving…" : `Save lecture (${absent.size} absent)`}</Button>
      </CardBody>
    </Card>
  );
}

function Condone({ row, semesterId }: { row: AttRow; semesterId: number }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Condone</Button>;
  return (
    <span className="inline-flex items-center gap-1">
      <Input className="h-7 w-44 text-[12px]" aria-label={`Reason for ${row.student_name}`} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await condone({ semesterId, studentId: row.student_id, subjectId: row.subject_id, reason }); setMsg(r.ok ? null : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>Save</Button>
      <Msg m={msg} />
    </span>
  );
}

export function AttendanceShortage({ rows, minimum, semesterId, canCondone }: { rows: AttRow[]; minimum: number; semesterId: number; canCondone: boolean }) {
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
              <td className="px-4 py-1.5">{r.condoned ? <span className="text-up">Condoned</span> : canCondone ? <Condone row={r} semesterId={semesterId} /> : <span className="text-down">Short</span>}</td>
            </tr>))}</tbody></table>
        )}
      </CardBody>
    </Card>
  );
}

export function MyAttendance({ rows, minimum }: { rows: AttRow[]; minimum: number }) {
  if (!rows.length) return <p className="text-[13px] text-ink-500">No lectures have been marked yet this semester.</p>;
  return (
    <Card>
      <CardBody className="p-0">
        <table className="w-full text-[13px]"><tbody>{rows.map((r) => (
          <tr key={r.subject_id} className="border-t border-hair first:border-t-0">
            <td className="px-4 py-2 font-medium">{r.subject}</td><td className="px-4 py-2 text-right tabular">{r.attended} of {r.held}</td>
            <td className={`px-4 py-2 text-right tabular ${r.short && !r.condoned ? "text-down" : "text-up"}`}>{Number(r.percent)}%</td>
            <td className="px-4 py-2 text-[12px] text-ink-500">{r.short ? (r.condoned ? "condoned" : `below ${minimum}%: speak to your class teacher`) : ""}</td>
          </tr>))}</tbody></table>
      </CardBody>
    </Card>
  );
}
