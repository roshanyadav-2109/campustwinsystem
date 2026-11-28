"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { roomRoster, markExamAttendance, reportIncident, saveBooklets, type RosterRow } from "@/app/dashboard/exam-cell/actions";

export type Duty = { session_id: number; exam_date: string; starts_at: string; room_id: number; room: { name: string }; session: { name: string } };
type Seat = RosterRow;

export function InvigilationDesk({ duties }: { duties: Duty[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [absent, setAbsent] = useState<Set<number>>(new Set());
  const [incident, setIncident] = useState<{ seat: number; text: string } | null>(null);
  const [book, setBook] = useState<Record<number, { b: string; e: string; late: boolean }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!duties.length) return <p className="text-[13px] text-ink-500">You have no exam duties coming up.</p>;
  return (
    <div className="space-y-3">
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      {duties.map((d) => { const key = `${d.session_id}|${d.exam_date}|${d.starts_at}|${d.room_id}`; return (
        <Card key={key}>
          <CardHeader title={`${d.exam_date} ${d.starts_at.slice(0, 5)} · ${d.room.name}`} action={<Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => {
            const r = await roomRoster(d.session_id, d.exam_date, d.starts_at, d.room_id); setSeats(r); setBook(Object.fromEntries(r.map((x) => [x.seat_id, { b: x.booklet_no ?? "", e: x.extra_sheets == null ? "" : String(x.extra_sheets), late: x.late }]))); setAbsent(new Set(r.filter((x) => x.present === false).map((x) => x.seat_id))); setOpen(key); })}>{open === key ? "Reload" : "Open roster"}</Button>} />
          {open === key && <CardBody className="space-y-2 p-0">
            <p className="px-4 pt-2 text-[12px] text-ink-500">{d.session.name}. Tap a student to mark absent.</p>
            <div className="grid grid-cols-2 gap-1.5 px-4 sm:grid-cols-4">{seats.map((x) => (
              <button key={x.seat_id} aria-pressed={absent.has(x.seat_id)} aria-label={`${x.student_name}: absent`} onClick={() => { const n = new Set(absent); if (n.has(x.seat_id)) n.delete(x.seat_id); else n.add(x.seat_id); setAbsent(n); }}
                className={`rounded-sm border px-2 py-1.5 text-left text-[12px] ${absent.has(x.seat_id) ? "border-down bg-down text-white" : "border-hair bg-white"}`}>
                <span className="tabular">{x.seat_label}</span> {x.student_name}{x.needs ? <span className="block text-[11px]">{x.needs}</span> : null}</button>))}</div>
            <details className="px-4"><summary className="cursor-pointer text-[12px] font-medium text-ink-700">Answer booklets and late arrivals</summary>
              <table className="mt-1 text-[12px]"><tbody>{seats.map((x) => { const v = book[x.seat_id] ?? { b: "", e: "", late: false }; return (
                <tr key={x.seat_id}><td className="pr-2 tabular">{x.seat_label}</td><td className="pr-2">{x.student_name}</td>
                  <td className="pr-2"><Input className="h-7 w-32 text-[12px]" aria-label={`${x.student_name}: booklet number`} placeholder="Booklet no." data-booklet value={v.b} onChange={(e) => setBook({ ...book, [x.seat_id]: { ...v, b: e.target.value } })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const all = [...document.querySelectorAll<HTMLInputElement>("input[data-booklet]")]; all[all.indexOf(e.currentTarget) + 1]?.focus(); } }} /></td>
                  <td className="pr-2"><Input className="h-7 w-16 text-[12px]" aria-label={`${x.student_name}: extra sheets`} placeholder="Extra" inputMode="numeric" value={v.e} onChange={(e) => setBook({ ...book, [x.seat_id]: { ...v, e: e.target.value } })} /></td>
                  <td><label className="flex items-center gap-1"><input type="checkbox" checked={v.late} onChange={(e) => setBook({ ...book, [x.seat_id]: { ...v, late: e.target.checked } })} />Late</label></td></tr>); })}</tbody></table>
              <Button size="sm" variant="subtle" className="my-2" disabled={pending} onClick={() => start(async () => { const r = await saveBooklets(seats.map((x) => ({ seat: x.seat_id, booklet: book[x.seat_id]?.b ?? "", extra: book[x.seat_id]?.e ? Number(book[x.seat_id].e) : null, late: !!book[x.seat_id]?.late }))); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); })}>Save booklets</Button>
            </details>
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
              <Button size="sm" disabled={pending} onClick={() => start(async () => { const changed = seats.filter((x) => x.present === null || (x.present === false) !== absent.has(x.seat_id));
                if (!changed.length) { setMsg({ ok: true, text: "Nothing changed." }); return; }
                const r = await markExamAttendance(changed.map((x) => x.seat_id), changed.map((x) => !absent.has(x.seat_id)));
                if (r.ok) setSeats(seats.map((x) => ({ ...x, present: !absent.has(x.seat_id) }))); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); })}>Save attendance ({absent.size} absent)</Button>
              <select className="h-8 rounded-sm border border-hair text-[12px]" aria-label="Student for a malpractice report" value={incident?.seat ?? ""} onChange={(e) => setIncident({ seat: Number(e.target.value), text: incident?.text ?? "" })}>
                <option value="">Report malpractice…</option>{seats.map((x) => <option key={x.seat_id} value={x.seat_id}>{x.seat_label} {x.student_name}</option>)}</select>
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
