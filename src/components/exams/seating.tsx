"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { downloadPdfBook } from "@/lib/pdf";
import { addRoom, setRoomActive, generateSeating, assignDuties, seatingChart } from "@/app/dashboard/exam-cell/actions";

export type RoomRow = { id: number; name: string; capacity: number; active: boolean };
const t5 = (t: string) => t.slice(0, 5);

export function SeatingDesk({ rooms, sessionId, sessionName, seated, duties, school }: { rooms: RoomRow[]; sessionId: number; sessionName: string; seated: number; school: string;
  duties: { exam_date: string; starts_at: string; room: { name: string }; staff: { full_name: string } }[] }) {
  const [name, setName] = useState(""); const [cap, setCap] = useState("40"); const [per, setPer] = useState("1");
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
          { kind: "table" as const, headers: ["Seat", "Student", "Admission no.", "Signature"], right: [0], rows: list.map((r) => [String(r.seat_no), r.student_name, r.admission_no, ""]) }] }; }), `Seating ${sessionName}`);
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
            <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => addRoom(name, cap))}>Add room</Button>
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
              <tbody>{duties.map((d, i) => <tr key={i} className="border-t border-hair"><td className="px-4 py-1.5">{d.exam_date}</td><td className="px-4 py-1.5 tabular">{t5(d.starts_at)}</td><td className="px-4 py-1.5">{d.room.name}</td><td className="px-4 py-1.5">{d.staff.full_name}</td></tr>)}</tbody></table>)}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
