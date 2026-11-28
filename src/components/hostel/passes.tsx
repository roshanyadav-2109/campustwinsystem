"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { askPass, passStep, markRoll, setWarden } from "@/app/dashboard/hostel/pass-actions";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p> : null);
const when = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fromLocal = (v: string) => new Date(`${v}:00+05:30`).toISOString();
const STATUS: Record<string, string> = { pending: "Waiting", approved: "Approved", declined: "Declined", cancelled: "Cancelled", out: "Out now", back: "Back" };
export type PassRow = { id: number; student_id: number; kind: string; reason: string; out_at: string; back_by: string; status: string; decision_note: string | null; left_at: string | null; returned_at: string | null; student?: { full_name: string } | null };

// The family or the student: ask for a pass; see the passes.
export function FamilyPasses({ kids, passes }: { kids: { id: number; name: string }[]; passes: PassRow[] }) {
  const [f, setF] = useState({ child: kids[0]?.id ?? 0, kind: "outing", reason: "", out: "", back: "" });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-4 text-[13px]">
      <Note m={msg} />
      <Card><CardHeader title="Ask for a hostel pass" /><CardBody className="flex flex-wrap items-end gap-2">
        {kids.length > 1 && <label>Student<Select className="mt-1 h-8" aria-label="Student" value={f.child} onChange={(e) => setF({ ...f, child: Number(e.target.value) })}>{kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></label>}
        <label>Kind<Select className="mt-1 h-8" aria-label="Kind of pass" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="outing">Outing (same day)</option><option value="home">Going home</option></Select></label>
        <label>Leaving<Input type="datetime-local" className="mt-1 h-8" aria-label="Leaving at" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} /></label>
        <label>Back by<Input type="datetime-local" className="mt-1 h-8" aria-label="Back by" value={f.back} onChange={(e) => setF({ ...f, back: e.target.value })} /></label>
        <label className="flex-1">Reason<Input className="mt-1 h-8" aria-label="Reason for the pass" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <Button size="sm" disabled={pending || !f.out || !f.back || f.reason.trim().length < 3} onClick={() => start(async () => { const r = await askPass(f.child, f.kind, f.reason, fromLocal(f.out), fromLocal(f.back)); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) { setF({ ...f, reason: "", out: "", back: "" }); router.refresh(); } })}>Send to the warden</Button>
      </CardBody></Card>
      <Card><CardHeader title="Passes" /><CardBody className="p-0">{passes.length === 0 ? <p className="px-4 py-3 text-ink-500">No passes yet.</p> : (
        <table className="w-full"><tbody>{passes.map((p) => (
          <tr key={p.id} className="border-t border-hair first:border-t-0">
            <td className="px-4 py-1.5">{p.kind === "home" ? "Home" : "Outing"}: {p.reason}<span className="block text-[12px] text-ink-500">{when(p.out_at)} to {when(p.back_by)}</span></td>
            <td className="px-2 py-1.5">{STATUS[p.status]}{p.decision_note ? ` (${p.decision_note})` : ""}</td>
            <td className="px-4 py-1.5 text-right">{["pending", "approved"].includes(p.status) && <button type="button" className="text-[12px] text-ink-500 hover:text-down" onClick={() => start(async () => { const r = await passStep(p.id, "cancel"); setMsg(r.ok ? { ok: true, text: "Cancelled." } : { ok: false, text: r.error }); router.refresh(); })}>cancel</button>}</td>
          </tr>))}</tbody></table>)}</CardBody></Card>
    </div>
  );
}

// The warden (or office): passes to approve, students to mark out and back.
export function WardenPasses({ passes }: { passes: PassRow[] }) {
  const [note, setNote] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const step = (id: number, s: string) => start(async () => { const r = await passStep(id, s, note[id] ?? ""); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error }); router.refresh(); });
  const late = (p: PassRow) => p.status === "out" && new Date(p.back_by).getTime() < Date.now();
  return (
    <Card><CardHeader title="Hostel passes" /><CardBody className="space-y-2 text-[13px]">
      <Note m={msg} />
      {passes.length === 0 ? <p className="text-ink-500">No passes waiting or out.</p> : passes.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 border-t border-hair pt-2 first:border-0 first:pt-0">
          <b>{p.student?.full_name}</b><span>{p.kind === "home" ? "Home" : "Outing"}: {p.reason}</span><span className="text-ink-500">{when(p.out_at)} to {when(p.back_by)}</span>
          <span className={late(p) ? "font-medium text-down" : "text-ink-700"}>{late(p) ? "Late" : STATUS[p.status]}</span>
          {p.status === "pending" && <>
            <Input className="h-8 w-44 text-[12px]" aria-label={`Note for ${p.student?.full_name}`} placeholder="Note (needed to decline)" value={note[p.id] ?? ""} onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} />
            <Button size="sm" disabled={pending} onClick={() => step(p.id, "approve")}>Approve</Button>
            <Button size="sm" variant="ghost" disabled={pending || !(note[p.id] ?? "").trim()} onClick={() => step(p.id, "decline")}>Decline</Button></>}
          {p.status === "approved" && <Button size="sm" variant="subtle" disabled={pending} onClick={() => step(p.id, "left")}>Left now</Button>}
          {p.status === "out" && <Button size="sm" variant="subtle" disabled={pending} onClick={() => step(p.id, "back")}>Back now</Button>}
        </div>))}
    </CardBody></Card>
  );
}

// Tonight's roll call: tap the absent; students away on a pass are filled in.
export function RollCall({ hostelId, day, rows }: { hostelId: number; day: string; rows: { student_id: number; student_name: string; room: string; status: string | null; on_pass: boolean }[] }) {
  const [absent, setAbsent] = useState<Set<number>>(new Set(rows.filter((r) => r.status === "absent").map((r) => r.student_id)));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const marked = rows.some((r) => r.status);
  return (
    <Card><CardHeader title={`Roll call ${marked ? "(taken; you can correct it)" : ""}`} /><CardBody className="space-y-2 text-[13px]">
      <Note m={msg} />
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{rows.map((r) => (
        <button key={r.student_id} type="button" disabled={r.on_pass} aria-pressed={absent.has(r.student_id)} aria-label={`${r.student_name}: absent`}
          onClick={() => setAbsent((s) => { const n = new Set(s); if (n.has(r.student_id)) n.delete(r.student_id); else n.add(r.student_id); return n; })}
          className={`rounded-sm border px-2 py-1.5 text-left ${r.on_pass ? "border-hair bg-[#f5f5f5] text-ink-500" : absent.has(r.student_id) ? "border-down bg-down text-white" : "border-hair bg-white"}`}>
          <span className="block text-[11px] opacity-70">{r.room}</span>{r.student_name}{r.on_pass ? " · on pass" : ""}</button>))}</div>
      <Button size="sm" disabled={pending || !rows.length} onClick={() => start(async () => { const r = await markRoll(hostelId, day, [...absent]); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Save the roll ({absent.size} absent)</Button>
    </CardBody></Card>
  );
}

export function Wardens({ hostels, staff }: { hostels: { id: number; name: string; warden_staff_id: number | null }[]; staff: { id: number; name: string }[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card><CardHeader title="Wardens" /><CardBody className="space-y-1.5 text-[13px]">
      <Note m={msg} />
      {hostels.map((h) => (
        <div key={h.id} className="flex items-center gap-2"><span className="w-40">{h.name}</span>
          <Select className="h-8 w-56" aria-label={`Warden of ${h.name}`} defaultValue={h.warden_staff_id ?? ""} disabled={pending}
            onChange={(e) => start(async () => { const r = await setWarden(h.id, e.target.value ? Number(e.target.value) : null); setMsg(r.ok ? { ok: true, text: "Warden saved; they can approve passes and take the roll." } : { ok: false, text: r.error }); router.refresh(); })}>
            <option value="">No warden</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>))}
    </CardBody></Card>
  );
}
