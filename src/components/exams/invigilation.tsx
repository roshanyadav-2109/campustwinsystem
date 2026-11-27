"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { roomRoster, markExamAttendance, reportIncident } from "@/app/dashboard/exam-cell/actions";

export type Duty = { session_id: number; exam_date: string; starts_at: string; room: { name: string }; session: { name: string } };
type Seat = { seat_id: number; seat_no: number; student_name: string; admission_no: string; room: string; present: boolean | null };

export function InvigilationDesk({ duties }: { duties: Duty[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [absent, setAbsent] = useState<Set<number>>(new Set());
  const [incident, setIncident] = useState<{ seat: number; text: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!duties.length) return <p className="text-[13px] text-ink-500">You have no exam duties coming up.</p>;
  return (
    <div className="space-y-3">
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      {duties.map((d) => { const key = `${d.session_id}|${d.exam_date}|${d.starts_at}`; return (
        <Card key={key}>
          <CardHeader title={`${d.exam_date} ${d.starts_at.slice(0, 5)} · ${d.room.name}`} action={<Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => {
            const r = await roomRoster(d.session_id, d.exam_date, d.starts_at); setSeats(r); setAbsent(new Set(r.filter((x) => x.present === false).map((x) => x.seat_id))); setOpen(key); })}>{open === key ? "Reload" : "Open roster"}</Button>} />
          {open === key && <CardBody className="space-y-2 p-0">
            <p className="px-4 pt-2 text-[12px] text-ink-500">{d.session.name}. Tap a student to mark absent.</p>
            <div className="grid grid-cols-2 gap-1.5 px-4 sm:grid-cols-4">{seats.map((x) => (
              <button key={x.seat_id} aria-pressed={absent.has(x.seat_id)} aria-label={`${x.student_name}: absent`} onClick={() => { const n = new Set(absent); if (n.has(x.seat_id)) n.delete(x.seat_id); else n.add(x.seat_id); setAbsent(n); }}
                className={`rounded-sm border px-2 py-1.5 text-left text-[12px] ${absent.has(x.seat_id) ? "border-down bg-down text-white" : "border-hair bg-white"}`}>
                <span className="tabular">{x.seat_no}</span> {x.student_name}</button>))}</div>
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
              <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await markExamAttendance(seats.map((x) => x.seat_id), seats.map((x) => !absent.has(x.seat_id))); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); })}>Save attendance ({absent.size} absent)</Button>
              <select className="h-8 rounded-sm border border-hair text-[12px]" aria-label="Student for a malpractice report" value={incident?.seat ?? ""} onChange={(e) => setIncident({ seat: Number(e.target.value), text: incident?.text ?? "" })}>
                <option value="">Report malpractice…</option>{seats.map((x) => <option key={x.seat_id} value={x.seat_id}>{x.seat_no} {x.student_name}</option>)}</select>
              {incident?.seat ? <>
                <Input className="h-8 w-64 text-[12px]" aria-label="What happened" placeholder="What happened" value={incident.text} onChange={(e) => setIncident({ ...incident, text: e.target.value })} />
                <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const r = await reportIncident(incident.seat, incident.text); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) setIncident(null); })}>Report</Button>
              </> : null}
            </div>
          </CardBody>}
        </Card>); })}
    </div>
  );
}
