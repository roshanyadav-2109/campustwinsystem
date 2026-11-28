"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { addMedicine, stopMedicine, recordDose } from "@/app/dashboard/front-desk/medicine-actions";

export type DueDose = { medicine_id: number; student_id: number; student_name: string; class_label: string | null; medicine: string; dose: string; due_at: string; instructions: string | null; allergies: string | null; status: string | null; given_by: string | null; note: string | null };
export type MedicineRow = { id: number; student_id: number; medicine: string; dose: string; times: string[]; from_date: string; to_date: string; instructions: string | null; doctor: string | null; status: string; student?: { full_name: string } | null };
export type DoseRow = { id: number; medicine_id: number; due_on: string; due_at: string; status: string; note: string | null; given_at: string };
const hm = (t: string) => t.slice(0, 5);
const dmy = (d: string) => d.split("-").reverse().join("/");
type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p> : null);

function MedicineForm({ kids, onDone }: { kids: { id: number; name: string }[] | null; onDone: (m: Msg) => void }) {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [f, setF] = useState({ child: kids?.[0]?.id ?? 0, adm: "", medicine: "", dose: "", times: "10:30", from: today, to: today, instructions: "", doctor: "", consent: false });
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2 text-[13px]">
      {kids ? (kids.length > 1 && <label>Child<Select className="mt-1 h-8" aria-label="Child" value={f.child} onChange={(e) => setF({ ...f, child: Number(e.target.value) })}>{kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></label>)
        : <label>Admission no.<Input className="mt-1 h-8 w-32" aria-label="Admission number for the medicine" value={f.adm} onChange={(e) => setF({ ...f, adm: e.target.value })} /></label>}
      <label>Medicine<Input className="mt-1 h-8 w-40" aria-label="Medicine" value={f.medicine} onChange={(e) => setF({ ...f, medicine: e.target.value })} /></label>
      <label>Dose<Input className="mt-1 h-8 w-24" aria-label="Dose" placeholder="5 ml" value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} /></label>
      <label>Times<Input className="mt-1 h-8 w-32" aria-label="Times of day" placeholder="10:30, 13:00" value={f.times} onChange={(e) => setF({ ...f, times: e.target.value })} /></label>
      <label>From<Input type="date" className="mt-1 h-8" aria-label="First day" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
      <label>To<Input type="date" className="mt-1 h-8" aria-label="Last day" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      <label>Instructions<Input className="mt-1 h-8 w-48" aria-label="Instructions" placeholder="After lunch" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
      <label>Doctor<Input className="mt-1 h-8 w-36" aria-label="Doctor" value={f.doctor} onChange={(e) => setF({ ...f, doctor: e.target.value })} /></label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />{kids ? "I ask the school to give this medicine" : "The parent has given written consent"}</label>
      <Button size="sm" disabled={pending} onClick={() => start(async () => {
        const times = f.times.split(/[,\s]+/).filter(Boolean);
        const r = await addMedicine({ studentId: kids ? f.child : null, admissionNo: f.adm, medicine: f.medicine, dose: f.dose, times, from: f.from, to: f.to, instructions: f.instructions, doctor: f.doctor, consent: f.consent });
        onDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
        if (r.ok) setF({ ...f, medicine: "", dose: "", instructions: "", doctor: "", consent: false });
      })}>Add the medicine</Button>
    </div>
  );
}

// The school's side: today's doses, and the medicines being given.
export function MedicineDesk({ due, active }: { due: DueDose[]; active: MedicineRow[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (d: DueDose, status: "given" | "refused" | "missed") => start(async () => { const r = await recordDose(d.medicine_id, d.due_at, status, note[`${d.medicine_id}|${d.due_at}`] ?? ""); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh(); });
  return (
    <div className="space-y-4">
      <Note m={msg} />
      <Card>
        <CardHeader title={`Today's doses (${due.filter((d) => !d.status).length} to give)`} />
        <CardBody className="p-0">
          {due.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No medicines today.</p> : (
            <table className="w-full text-[13px]"><tbody>{due.map((d) => { const k = `${d.medicine_id}|${d.due_at}`; return (
              <tr key={k} className="border-t border-hair align-top">
                <td className="px-4 py-2 tabular">{hm(d.due_at)}</td>
                <td className="px-2 py-2"><b>{d.student_name}</b> <span className="text-ink-500">{d.class_label}</span>{d.allergies ? <span className="block text-[12px] text-down">Allergies: {d.allergies}</span> : null}</td>
                <td className="px-2 py-2">{d.medicine}, {d.dose}{d.instructions ? <span className="block text-[12px] text-ink-500">{d.instructions}</span> : null}</td>
                <td className="px-2 py-2 text-right">{d.status ? <span className={d.status === "given" ? "text-up" : "text-down"}>{d.status}{d.given_by ? ` by ${d.given_by}` : ""}{d.note ? ` (${d.note})` : ""}</span> : <>
                  <Input className="mb-1 h-7 w-36 text-[12px]" aria-label={`Note for ${d.student_name}`} placeholder="Note" value={note[k] ?? ""} onChange={(e) => setNote({ ...note, [k]: e.target.value })} />
                  <span className="flex justify-end gap-1"><Button size="sm" disabled={pending} onClick={() => act(d, "given")}>Given</Button>
                    <Button size="sm" variant="subtle" disabled={pending} onClick={() => act(d, "refused")}>Refused</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(d, "missed")}>Missed</Button></span></>}</td>
              </tr>); })}</tbody></table>)}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Add a medicine" />
        <CardBody><MedicineForm kids={null} onDone={(m) => { setMsg(m); if (m?.ok) router.refresh(); }} /></CardBody>
      </Card>
      {active.length > 0 && <Card>
        <CardHeader title="Medicines being given" />
        <CardBody className="space-y-1 text-[13px]">{active.map((m) => (
          <p key={m.id} className="flex flex-wrap items-center gap-2"><b>{m.student?.full_name ?? ""}</b> {m.medicine}, {m.dose} at {m.times.map(hm).join(", ")}, {dmy(m.from_date)} to {dmy(m.to_date)}{m.doctor ? `, ${m.doctor}` : ""}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await stopMedicine(m.id); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh(); })}>Stop</Button></p>))}</CardBody>
      </Card>}
    </div>
  );
}

// The family's side: ask the school to give a medicine; see what was given.
export function FamilyMedicines({ kids, active, doses }: { kids: { id: number; name: string }[]; active: MedicineRow[]; doses: DoseRow[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const byId = new Map(active.map((m) => [m.id, m]));
  return (
    <Card>
      <CardHeader title="Medicines at school" />
      <CardBody className="space-y-3 text-[13px]">
        <Note m={msg} />
        {active.length > 0 && <div className="space-y-1">{active.map((m) => (
          <p key={m.id} className="flex flex-wrap items-center gap-2">{m.medicine}, {m.dose} at {m.times.map(hm).join(", ")}, {dmy(m.from_date)} to {dmy(m.to_date)}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await stopMedicine(m.id); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh(); })}>Stop</Button></p>))}</div>}
        {doses.length > 0 && <ul className="space-y-0.5 text-ink-700">{doses.slice(0, 20).map((d) => (
          <li key={d.id}>{dmy(d.due_on)} {hm(d.due_at)}: {byId.get(d.medicine_id)?.medicine ?? "Medicine"} {d.status}{d.note ? ` (${d.note})` : ""}</li>))}</ul>}
        {kids.length > 0 && <MedicineForm kids={kids} onDone={(m) => { setMsg(m); if (m?.ok) router.refresh(); }} />}
        <p className="text-[12px] text-ink-500">Send the medicine in its original pack with your child. The school gives it only with your request here.</p>
      </CardBody>
    </Card>
  );
}
