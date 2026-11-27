"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { saveAttendanceRules } from "@/app/dashboard/relaxations/actions";

type Rules = { mode: string; days: string; minimum: string; floor: string; holdFees: boolean; cutoff: string; chain: Record<string, string[]> };
const MODES: [string, string][] = [
  ["daily", "Daily: each day locks a few days after the lecture"],
  ["cutoff", "Before exams: frozen on a cut-off date set for the semester"],
  ["both", "Both: daily lock, and a final freeze on the cut-off date"],
  ["none", "No lock"],
];
const TYPES: [string, string][] = [["advisor", "Class teacher"], ["office", "Office"], ["head", "Principal / head"]];
const KINDS: [string, string][] = [["attendance", "Attendance relaxation"], ["fees", "Fee extension"], ["unlock", "Unlock locked attendance"]];

function Chain({ value, onChange, disabled, label }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-ink-500">→</span>}
          <Select className="h-8 text-[13px]" aria-label={`${label}, step ${i + 1}`} disabled={disabled} value={t} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}>
            {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          {!disabled && value.length > 1 && <Button size="sm" variant="ghost" aria-label={`Remove step ${i + 1} from ${label}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</Button>}
        </span>
      ))}
      {!disabled && value.length < 4 && <Button size="sm" variant="ghost" onClick={() => onChange([...value, "head"])}>Add step</Button>}
    </div>
  );
}

export function AttendanceRules({ initial, canEdit, hasSemester }: { initial: Rules; canEdit: boolean; hasSemester: boolean }) {
  const [r, setR] = useState<Rules>({ ...initial, chain: { attendance: ["advisor", "head"], fees: ["office"], unlock: ["head"], ...initial.chain } });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const off = !canEdit;
  const cut = r.mode === "cutoff" || r.mode === "both";
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Attendance lock" />
        <CardBody className="space-y-3 text-[13px]">
          <fieldset className="space-y-1.5">
            <legend className="sr-only">How attendance locks</legend>
            {MODES.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="radio" name="mode" value={k} disabled={off} checked={r.mode === k} onChange={() => setR({ ...r, mode: k })} />{l}</label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-4">
            {(r.mode === "daily" || r.mode === "both") && <label className="text-[12px] text-ink-700">Days a teacher can still correct<Input className="mt-0.5 h-8 w-20" disabled={off} value={r.days} onChange={(e) => setR({ ...r, days: e.target.value })} /></label>}
            {cut && <label className="text-[12px] text-ink-700">Attendance cut-off for this semester{!hasSemester && " (set a current semester first)"}<Input type="date" className="mt-0.5 h-8" disabled={off || !hasSemester} value={r.cutoff} onChange={(e) => setR({ ...r, cutoff: e.target.value })} /></label>}
          </div>
          {cut && <p className="text-[12px] text-ink-500">After the cut-off, attendance up to that date is frozen. Shortage, hall tickets and results use attendance up to the cut-off.</p>}
          <p className="text-[12px] text-ink-500">A locked day opens only through an approved unlock request. Every change to a lecture already marked is recorded.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Holds" />
        <CardBody className="space-y-3 text-[13px]">
          <div className="flex flex-wrap gap-4">
            <label className="text-[12px] text-ink-700">Minimum attendance, %<Input className="mt-0.5 h-8 w-20" disabled={off} value={r.minimum} onChange={(e) => setR({ ...r, minimum: e.target.value })} /></label>
            <label className="text-[12px] text-ink-700">Cannot be relaxed below, % (empty: any)<Input className="mt-0.5 h-8 w-20" disabled={off} value={r.floor} onChange={(e) => setR({ ...r, floor: e.target.value })} /></label>
          </div>
          <p className="text-[12px] text-ink-500">Below the minimum in a course, the hall ticket and results are held back automatically until the shortage is relaxed.</p>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={off} checked={r.holdFees} onChange={(e) => setR({ ...r, holdFees: e.target.checked })} />Hold back results while fees are overdue</label>
          <p className="text-[12px] text-ink-500">Hall tickets are held for overdue fees when the exam is set to do so (Exam timetable). Paying, or an approved fee extension, releases at once.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Who approves, in order" />
        <CardBody className="space-y-3 text-[13px]">
          {KINDS.map(([k, l]) => (
            <div key={k} className="flex flex-wrap items-center gap-3"><span className="w-52 font-medium">{l}</span>
              <Chain label={l} disabled={off} value={r.chain[k] ?? ["head"]} onChange={(v) => setR({ ...r, chain: { ...r.chain, [k]: v } })} /></div>
          ))}
          <p className="text-[12px] text-ink-500">Each person approves in turn; the principal can approve at any step. Department heads and deans join this list with roles and positions.</p>
        </CardBody>
      </Card>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button disabled={pending} onClick={() => start(async () => { const x = await saveAttendanceRules(r); setMsg(x.ok ? { ok: true, text: x.message ?? "Saved." } : { ok: false, text: x.error }); if (x.ok) router.refresh(); })}>Save</Button>
          {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
