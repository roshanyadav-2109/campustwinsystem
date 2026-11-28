"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { downloadPdfBook } from "@/lib/pdf";
import { addRoom, setRoomActive, generateSeating, assignDuties, seatingChart, swapDuty, saveAccommodation, removeAccommodation, saveRates, remuneration } from "@/app/dashboard/exam-cell/actions";
import { downloadPdf } from "@/lib/pdf";
import { Select } from "@/components/ui/field";

export type RoomRow = { id: number; name: string; capacity: number; active: boolean };
const t5 = (t: string) => t.slice(0, 5);

export type Accommodation = { id: number; session_id: number | null; scribe: boolean; scribe_name: string | null; extra_minutes: number; note: string | null; student: { full_name: string; admission_no: string } };
export function SeatingDesk({ rooms, sessionId, sessionName, seated, duties, school, teachers = [], accommodations = [], rates = { duty: 0, script: 0 }, canSetRates = false }: { rooms: RoomRow[]; sessionId: number; sessionName: string; seated: number; school: string;
  duties: { id: number; exam_date: string; starts_at: string; room: { name: string }; staff: { id: number; full_name: string } }[]; teachers?: { id: number; name: string }[];
  accommodations?: Accommodation[]; rates?: { duty: number; script: number }; canSetRates?: boolean }) {
  const [name, setName] = useState(""); const [cap, setCap] = useState("40"); const [per, setPer] = useState("1");
  const [rowsN, setRowsN] = useState(""); const [benches, setBenches] = useState(""); const [perBench, setPerBench] = useState("2");
  const [acc, setAcc] = useState({ adm: "", scribe: false, scribeName: "", extra: "0", note: "", all: true });
  const [rate, setRate] = useState({ duty: String(rates.duty || ""), script: String(rates.script || "") });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) router.refresh(); });
  const total = rooms.filter((r) => r.active).reduce((a, r) => a + r.capacity, 0);
  const charts = () => start(async () => {
    const rows = await seatingChart(sessionId);
    if (!rows.length) { setMsg({ ok: false, text: "Plan the seating first." }); return; }
    const keys = [...new Set(rows.map((r) => `${r.exam_date}|${r.starts_at}|${r.room}`))];
    await downloadPdfBook(keys.map((k) => { const [d, s, room] = k.split("|"); const list = rows.filter((r) => `${r.exam_date}|${r.starts_at}|${r.room}` === k);
      return { filename: `Seating ${room} ${d} ${t5(s)}`, title: `Seating: ${room}`, meta: [sessionName, `${d} ${t5(s)}`], school,
        blocks: [{ kind: "facts" as const, items: [["Room", room], ["Invigilators", list[0]?.invigilators ?? "-"], ["Candidates", String(list.length)]] as [string, string][] },
          { kind: "table" as const, headers: ["Seat", "Student", "Admission no.", "Needs", "Booklet no.", "Signature"], rows: list.map((r) => [r.seat_label || String(r.seat_no), r.student_name, r.admission_no, r.needs ?? "", "", ""]) }] }; }), `Seating ${sessionName}`);
    setMsg({ ok: true, text: `${keys.length} room charts downloaded.` });
  });
  return (
    <div className="space-y-4">
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      <Card>
        <CardHeader title={`Rooms (${rooms.filter((r) => r.active).length} in use, ${total} seats)`} />
        <CardBody className="space-y-2 text-[13px]">
          <div className="flex flex-wrap gap-1.5">{rooms.map((r) => (
            <button key={r.id} onClick={() => run(() => setRoomActive(r.id, !r.active))} className={`rounded-sm border px-2.5 py-1 ${r.active ? "border-hair bg-white" : "border-dashed border-hair text-ink-500"}`} title={r.active ? "Click to take out of use" : "Click to use"}>{r.name} · {r.capacity}</button>))}</div>
          <div className="flex flex-wrap items-end gap-2">
            <Input className="h-8 w-40 text-[13px]" aria-label="Room name" placeholder="Room, for example Hall A" value={name} onChange={(e) => setName(e.target.value)} />
            <Input className="h-8 w-20 text-[13px]" aria-label="Seats" value={cap} onChange={(e) => setCap(e.target.value)} />
            <span className="text-ink-500">or</span>
            <Input className="h-8 w-16 text-[13px]" aria-label="Rows" placeholder="rows" value={rowsN} onChange={(e) => setRowsN(e.target.value)} />
            <Input className="h-8 w-20 text-[13px]" aria-label="Benches in a row" placeholder="benches" value={benches} onChange={(e) => setBenches(e.target.value)} />
            <Select className="h-8 w-28 text-[13px]" aria-label="Students to a bench" value={perBench} onChange={(e) => setPerBench(e.target.value)}><option value="1">1 to a bench</option><option value="2">2 to a bench</option><option value="3">3 to a bench</option></Select>
            <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => addRoom(name, cap, { rows: rowsN, benches, perBench }))}>Add room</Button>
          </div>
        </CardBody>
      </Card>
      {sessionId ? (
        <Card>
          <CardHeader title={`${sessionName}: ${seated} seats planned`} action={
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={pending} onClick={() => run(() => generateSeating(sessionId))}>Plan seating</Button>
              <label className="flex items-center gap-1 text-[12px]">Invigilators per room<Input className="h-8 w-14 text-[12px]" value={per} onChange={(e) => setPer(e.target.value)} /></label>
              <Button size="sm" variant="subtle" disabled={pending || !seated} onClick={() => run(() => assignDuties(sessionId, Number(per) || 1))}>Assign duties</Button>
              <Button size="sm" variant="subtle" disabled={pending || !seated} onClick={charts}>Room charts</Button>
            </div>} />
          <CardBody className="p-0">{duties.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No duties yet. Plan the seating, then assign duties.</p> : (
            <table className="w-full text-[13px]"><thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Time</th><th className="px-4 py-2 font-medium">Room</th><th className="px-4 py-2 font-medium">Invigilator</th></tr></thead>
              <tbody>{duties.map((d) => <tr key={d.id} className="border-t border-hair"><td className="px-4 py-1.5">{d.exam_date}</td><td className="px-4 py-1.5 tabular">{t5(d.starts_at)}</td><td className="px-4 py-1.5">{d.room.name}</td>
                <td className="px-4 py-1.5">{teachers.length ? <Select className="h-8 w-56 text-[12px]" aria-label={`Invigilator for ${d.room.name} ${d.exam_date}`} value={d.staff.id} disabled={pending} onChange={(e) => run(() => swapDuty(d.id, Number(e.target.value)))}>
                  {[{ id: d.staff.id, name: d.staff.full_name }, ...teachers.filter((t) => t.id !== d.staff.id)].map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select> : d.staff.full_name}</td></tr>)}</tbody></table>)}
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Scribes and extra time" />
        <CardBody className="space-y-2 text-[13px]">
          {accommodations.length > 0 && <ul className="space-y-1">{accommodations.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2"><b>{a.student.full_name}</b> <span className="text-ink-500">{a.student.admission_no}</span>
              {[a.scribe ? `Scribe${a.scribe_name ? `: ${a.scribe_name}` : ""}` : null, a.extra_minutes ? `${a.extra_minutes} min extra` : null, a.note, a.session_id ? "this exam" : "every exam"].filter(Boolean).join(", ")}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeAccommodation(a.id))}>Remove</Button></li>))}</ul>}
          <div className="flex flex-wrap items-end gap-2">
            <Input className="h-8 w-36" aria-label="Admission number for a scribe or extra time" placeholder="Admission no." value={acc.adm} onChange={(e) => setAcc({ ...acc, adm: e.target.value })} />
            <label className="flex items-center gap-1"><input type="checkbox" checked={acc.scribe} onChange={(e) => setAcc({ ...acc, scribe: e.target.checked })} />Scribe</label>
            <Input className="h-8 w-40" aria-label="Scribe's name" placeholder="Scribe's name" value={acc.scribeName} onChange={(e) => setAcc({ ...acc, scribeName: e.target.value })} />
            <label className="flex items-center gap-1">Extra minutes<Input className="h-8 w-16" aria-label="Extra minutes" inputMode="numeric" value={acc.extra} onChange={(e) => setAcc({ ...acc, extra: e.target.value })} /></label>
            <Input className="h-8 w-48" aria-label="Note" placeholder="Note (e.g. ground-floor room)" value={acc.note} onChange={(e) => setAcc({ ...acc, note: e.target.value })} />
            <label className="flex items-center gap-1"><input type="checkbox" checked={acc.all} onChange={(e) => setAcc({ ...acc, all: e.target.checked })} />Every exam</label>
            <Button size="sm" variant="subtle" disabled={pending || !acc.adm.trim()} onClick={() => run(() => saveAccommodation({ admissionNo: acc.adm, sessionId: acc.all ? null : sessionId || null, scribe: acc.scribe, scribeName: acc.scribeName, extra: Number(acc.extra) || 0, note: acc.note }))}>Save</Button>
          </div>
        </CardBody>
      </Card>
      {sessionId ? <Card>
        <CardHeader title="Remuneration" />
        <CardBody className="flex flex-wrap items-end gap-2 text-[13px]">
          <label>Per duty (Rs)<Input className="mt-1 h-8 w-24" aria-label="Rate per duty" inputMode="decimal" disabled={!canSetRates} value={rate.duty} onChange={(e) => setRate({ ...rate, duty: e.target.value })} /></label>
          <label>Per script valued (Rs)<Input className="mt-1 h-8 w-24" aria-label="Rate per script" inputMode="decimal" disabled={!canSetRates} value={rate.script} onChange={(e) => setRate({ ...rate, script: e.target.value })} /></label>
          {canSetRates && <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => saveRates(rate.duty, rate.script))}>Save rates</Button>}
          <Button size="sm" disabled={pending} onClick={() => start(async () => {
            const rows = await remuneration(sessionId);
            if (!rows.length) { setMsg({ ok: false, text: "No duties or valued scripts yet." }); return; }
            const money = (v: number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 });
            await downloadPdf({ filename: `Remuneration ${sessionName}`, title: "Remuneration statement", meta: [sessionName], school,
              blocks: [{ kind: "table", headers: ["Staff", "Code", "Duties", "Scripts", "Duties (Rs)", "Scripts (Rs)", "Total (Rs)", "Signature"], right: [2, 3, 4, 5, 6],
                rows: [...rows.map((r) => [r.staff_name, r.employee_code ?? "", String(r.duties), String(r.scripts), money(r.duty_amount), money(r.script_amount), money(r.total), ""]),
                  ["Total", "", String(rows.reduce((a, r) => a + r.duties, 0)), String(rows.reduce((a, r) => a + r.scripts, 0)), money(rows.reduce((a, r) => a + Number(r.duty_amount), 0)), money(rows.reduce((a, r) => a + Number(r.script_amount), 0)), money(rows.reduce((a, r) => a + Number(r.total), 0)), ""]] },
                { kind: "signatures", labels: ["Prepared by", "Controller of Examinations", "Accounts"] }] });
            setMsg({ ok: true, text: `Statement for ${rows.length} staff downloaded.` });
          })}>Remuneration statement</Button>
        </CardBody>
      </Card> : null}
    </div>
  );
}
