"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { addVisitor, visitorOut, requestGatePass, decideGatePass, addHealthVisit, findStudents } from "@/app/dashboard/front-desk/actions";

export type VisitorRow = { id: number; name: string; phone: string | null; purpose: string | null; meeting: string | null; badge_no: string | null; in_at: string; out_at: string | null };
export type PassRow = { id: number; student_id: number; reason: string; pickup_name: string; pickup_relation: string | null; pickup_phone: string | null; leave_at: string; status: string;
  decision_note: string | null; left_at: string | null; created_at: string; student: { full_name: string; admission_no?: string } | null };
export type HealthRow = { id: number; student_id: number; visited_at: string; complaint: string; action_taken: string | null; sent_home: boolean; student: { full_name: string } | null };

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[12px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}
const STATUS: Record<string, string> = { requested: "Waiting for the office", approved: "Approved", rejected: "Not approved", left: "Left school", cancelled: "Cancelled" };

function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) { after?.(); router.refresh(); }
  });
  return { msg, pending, run };
}

function StudentPicker({ onPick, label }: { onPick: (s: { id: number; name: string } | null) => void; label: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: number; name: string; admission_no: string }[]>([]);
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [, start] = useTransition();
  if (picked) return <div className="flex items-center gap-2 text-[13px]"><span className="font-medium">{picked.name}</span><Button size="sm" variant="ghost" onClick={() => { setPicked(null); onPick(null); }}>Change</Button></div>;
  return (
    <div className="relative">
      <Input aria-label={label} placeholder="Name or admission number" value={q} onChange={(e) => { const v = e.target.value; setQ(v); start(async () => setHits(await findStudents(v))); }} />
      {hits.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-sm border border-hair bg-white text-[13px] shadow-sm">
          {hits.map((h) => <li key={h.id}><button className="w-full px-3 py-1.5 text-left hover:bg-panel" onClick={() => { setPicked({ id: h.id, name: h.name }); onPick({ id: h.id, name: h.name }); setHits([]); }}>{h.name} <span className="text-ink-500">{h.admission_no}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

export function VisitorsDesk({ today, stillIn }: { today: VisitorRow[]; stillIn: VisitorRow[] }) {
  const uid = useId();
  const blank = { name: "", phone: "", purpose: "", meeting: "", idProof: "", vehicle: "", badge: "" };
  const [v, setV] = useState(blank);
  const { msg, pending, run } = useAct();
  const inside = [...stillIn, ...today.filter((x) => !x.out_at)];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Sign a visitor in" action={<Msg m={msg} />} />
        <CardBody className="grid items-end gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {([["name", "Name"], ["phone", "Phone"], ["purpose", "Purpose"], ["meeting", "To meet"], ["idProof", "ID shown"], ["vehicle", "Vehicle"], ["badge", "Badge no."]] as const).map(([k, l]) => (
            <Field key={k} label={l} htmlFor={`${uid}-${k}`}><Input id={`${uid}-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
          ))}
          <Button disabled={pending} onClick={() => run(() => addVisitor(v), () => setV(blank))}>Sign in</Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`Still inside (${inside.length})`} />
        <CardBody className="p-0">
          {inside.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">Nobody is inside.</p> : (
            <ul>{inside.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-2 text-[13px] last:border-b-0">
                <span className="font-medium">{x.name}</span><span className="text-ink-700">{x.purpose}{x.meeting ? `, to meet ${x.meeting}` : ""}</span>
                <span className="text-ink-500">in {time(x.in_at)}{x.badge_no ? `, badge ${x.badge_no}` : ""}</span>
                <span className="flex-1" /><Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => visitorOut(x.id))}>Sign out</Button>
              </li>))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`Today (${today.length})`} />
        <CardBody className="p-0">
          <table className="w-full text-[13px]"><tbody>{today.map((x) => (
            <tr key={x.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5 font-medium">{x.name}</td><td className="px-4 py-1.5">{x.phone}</td><td className="px-4 py-1.5">{x.purpose}</td>
              <td className="px-4 py-1.5 tabular">{time(x.in_at)}</td><td className="px-4 py-1.5 tabular">{x.out_at ? time(x.out_at) : <span className="text-down">inside</span>}</td></tr>))}
          </tbody></table>
        </CardBody>
      </Card>
    </div>
  );
}

function PassForm({ kids }: { kids?: { id: number; name: string }[] }) {
  const uid = useId();
  const [student, setStudent] = useState<{ id: number; name: string } | null>(kids?.length === 1 ? kids[0] : null);
  const [f, setF] = useState({ reason: "", pickupName: "", relation: "", phone: "", leaveAt: "" });
  const { msg, pending, run } = useAct();
  return (
    <Card>
      <CardHeader title={kids ? "Ask for an early pick-up" : "Raise a gate pass"} action={<Msg m={msg} />} />
      <CardBody className="grid items-end gap-2 sm:grid-cols-3 xl:grid-cols-7">
        <Field label="Student" htmlFor={`${uid}-s`}>
          {kids ? (
            <Select id={`${uid}-s`} value={student?.id ?? ""} onChange={(e) => setStudent(kids.find((k) => k.id === Number(e.target.value)) ?? null)}>
              <option value="">Choose</option>{kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select>
          ) : <StudentPicker label="Student for the gate pass" onPick={setStudent} />}
        </Field>
        <Field label="Reason" htmlFor={`${uid}-r`}><Input id={`${uid}-r`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <Field label="Picked up by" htmlFor={`${uid}-p`}><Input id={`${uid}-p`} value={f.pickupName} onChange={(e) => setF({ ...f, pickupName: e.target.value })} /></Field>
        <Field label="Relation" htmlFor={`${uid}-rel`}><Input id={`${uid}-rel`} value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} /></Field>
        <Field label="Their phone" htmlFor={`${uid}-ph`}><Input id={`${uid}-ph`} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Leaving at" htmlFor={`${uid}-t`}><Input id={`${uid}-t`} type="datetime-local" value={f.leaveAt} onChange={(e) => setF({ ...f, leaveAt: e.target.value })} /></Field>
        <Button disabled={pending || !student} onClick={() => run(() => requestGatePass({ studentId: student!.id, ...f }), () => setF({ reason: "", pickupName: "", relation: "", phone: "", leaveAt: "" }))}>{kids ? "Send to the office" : "Raise"}</Button>
      </CardBody>
    </Card>
  );
}

export function GatePassDesk({ passes }: { passes: PassRow[] }) {
  const { msg, pending, run } = useAct();
  const [note, setNote] = useState<Record<number, string>>({});
  return (
    <div className="space-y-4">
      <PassForm />
      <Card>
        <CardHeader title="Gate passes (last 7 days and coming)" action={<Msg m={msg} />} />
        <CardBody className="p-0">
          {passes.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No gate passes.</p> : (
            <ul>{passes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-2 text-[13px] last:border-b-0">
                <span className="w-44 font-medium">{p.student?.full_name}</span>
                <span className="w-36 tabular text-ink-700">{time(p.leave_at)}</span>
                <span className="min-w-[220px] flex-1 text-ink-700">{p.reason}; with {p.pickup_name}{p.pickup_relation ? ` (${p.pickup_relation})` : ""}{p.pickup_phone ? `, ${p.pickup_phone}` : ""}</span>
                <span className={p.status === "requested" ? "text-down" : p.status === "rejected" ? "text-down" : "text-up"}>{STATUS[p.status]}{p.left_at ? ` ${time(p.left_at)}` : ""}</span>
                {p.status === "requested" && <>
                  <Input className="h-8 w-44 text-[12px]" aria-label="Note to the parents" placeholder="Note (optional)" value={note[p.id] ?? ""} onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} />
                  <Button size="sm" disabled={pending} onClick={() => run(() => decideGatePass(p.id, "approved", note[p.id] ?? ""))}>Approve</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => decideGatePass(p.id, "rejected", note[p.id] ?? ""))}>Decline</Button></>}
                {p.status === "approved" && <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => decideGatePass(p.id, "left", ""))}>Left now</Button>}
              </li>))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function HealthDesk({ visits }: { visits: HealthRow[] }) {
  const uid = useId();
  const [student, setStudent] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ complaint: "", action: "", sentHome: false, tellParent: true });
  const { msg, pending, run } = useAct();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Record a visit" action={<Msg m={msg} />} />
        <CardBody className="grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <Field label="Student" htmlFor={`${uid}-s`}><StudentPicker label="Student for the health visit" onPick={setStudent} /></Field>
          <Field label="Problem" htmlFor={`${uid}-c`}><Input id={`${uid}-c`} value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} /></Field>
          <Field label="What was done" htmlFor={`${uid}-a`}><Input id={`${uid}-a`} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} /></Field>
          <label className="flex items-center gap-1.5 pb-2 text-[13px]"><input type="checkbox" checked={f.sentHome} onChange={(e) => setF({ ...f, sentHome: e.target.checked })} className="h-4 w-4 accent-[#0F6CBD]" />Send home</label>
          <label className="flex items-center gap-1.5 pb-2 text-[13px]"><input type="checkbox" checked={f.tellParent} onChange={(e) => setF({ ...f, tellParent: e.target.checked })} className="h-4 w-4 accent-[#0F6CBD]" />Tell the parents</label>
          <Button disabled={pending || !student} onClick={() => run(() => addHealthVisit({ studentId: student!.id, ...f }), () => setF({ complaint: "", action: "", sentHome: false, tellParent: true }))}>Save</Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Last 30 days" />
        <CardBody className="p-0">
          <table className="w-full text-[13px]"><tbody>{visits.map((v) => (
            <tr key={v.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5 tabular">{time(v.visited_at)}</td><td className="px-4 py-1.5 font-medium">{v.student?.full_name}</td>
              <td className="px-4 py-1.5">{v.complaint}</td><td className="px-4 py-1.5 text-ink-700">{v.action_taken}</td><td className="px-4 py-1.5">{v.sent_home ? "Sent home" : ""}</td></tr>))}
          </tbody></table>
        </CardBody>
      </Card>
    </div>
  );
}

export function FamilyFrontDesk({ kids, passes, visits }: { kids: { id: number; name: string }[]; passes: PassRow[]; visits: HealthRow[] }) {
  const { msg, pending, run } = useAct();
  return (
    <div className="space-y-4">
      {kids.length > 0 && <PassForm kids={kids} />}
      <Card>
        <CardHeader title="Early pick-ups" action={<Msg m={msg} />} />
        <CardBody className="p-0">
          {passes.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">None yet.</p> : (
            <ul>{passes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-2 text-[13px] last:border-b-0">
                <span className="font-medium">{p.student?.full_name}</span><span className="tabular text-ink-700">{time(p.leave_at)}</span><span className="text-ink-700">{p.reason}</span>
                <span className="flex-1" /><span>{STATUS[p.status]}{p.decision_note ? `: ${p.decision_note}` : ""}</span>
                {p.status === "requested" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => decideGatePass(p.id, "cancelled", ""))}>Cancel</Button>}
              </li>))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Health room visits" />
        <CardBody className="p-0">
          {visits.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No visits.</p> : (
            <table className="w-full text-[13px]"><tbody>{visits.map((v) => (
              <tr key={v.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5 tabular">{time(v.visited_at)}</td><td className="px-4 py-1.5 font-medium">{v.student?.full_name}</td>
                <td className="px-4 py-1.5">{v.complaint}</td><td className="px-4 py-1.5 text-ink-700">{v.action_taken}</td></tr>))}
            </tbody></table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
