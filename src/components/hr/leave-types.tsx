"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { saveLeaveType, setLeaveTypeActive } from "@/app/dashboard/hr/actions";

export type LeaveTypeRow = { id: number; code: string; name: string; daysPerYear: number; isPaid: boolean; active: boolean };
const blank = { code: "", name: "", days: "0", paid: "yes" };

// The office decides which kinds of leave staff can take and how many days a
// year each allows. Switching one off keeps it on past requests.
export function LeaveTypesEditor({ types, canEdit }: { types: LeaveTypeRow[]; canEdit: boolean }) {
  const id = useId();
  const [editing, setEditing] = useState<number | null>(null);
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  function edit(t: LeaveTypeRow) {
    setEditing(t.id); setMsg(null);
    setF({ code: t.code, name: t.name, days: String(t.daysPerYear), paid: t.isPaid ? "yes" : "no" });
  }
  function reset() { setEditing(null); setF(blank); }
  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveLeaveType({ id: editing, code: f.code, name: f.name, daysPerYear: Number(f.days), isPaid: f.paid === "yes" });
      if (!res.ok) { setMsg({ text: res.error, ok: false }); return; }
      setMsg({ text: editing ? "Saved." : "Leave type added.", ok: true });
      reset();
    });
  }
  function toggle(t: LeaveTypeRow) {
    setMsg(null);
    start(async () => {
      const res = await setLeaveTypeActive(t.id, !t.active);
      setMsg(res.ok ? { text: t.active ? `${t.name} switched off.` : `${t.name} switched on.`, ok: true } : { text: res.error, ok: false });
    });
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader title="Leave types" />
        <CardBody className="pt-1">
          <ul className="divide-y divide-hair">
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className={`text-[14px] font-medium ${t.active ? "text-ink-900" : "text-ink-500 line-through"}`}>{t.name} <span className="font-normal text-ink-500">({t.code})</span></div>
                  <div className="text-[12px] text-ink-500">
                    {t.isPaid ? `${t.daysPerYear} days a year, paid` : "Unpaid, no limit"}{t.active ? "" : " · switched off"}
                  </div>
                </div>
                {canEdit && (
                  <>
                    <Button size="sm" variant="subtle" onClick={() => edit(t)} disabled={pending}>Edit</Button>
                    <Button size="sm" variant="subtle" onClick={() => toggle(t)} disabled={pending}>{t.active ? "Switch off" : "Switch on"}</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!canEdit && <p className="mt-3 text-[13px] text-ink-500">Only the school office can change leave types.</p>}
        </CardBody>
      </Card>
      {canEdit && (
        <Card>
          <CardHeader title={editing ? "Change leave type" : "Add a leave type"} />
          <CardBody className="space-y-3 pt-1">
            <Field label="Name" htmlFor={`${id}-n`}><Input id={`${id}-n`} value={f.name} maxLength={60} placeholder="Maternity leave" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Short code" htmlFor={`${id}-c`}><Input id={`${id}-c`} value={f.code} maxLength={8} placeholder="ML" onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
              <Field label="Paid?" htmlFor={`${id}-p`}>
                <Select id={`${id}-p`} value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })}>
                  <option value="yes">Paid</option><option value="no">Unpaid</option>
                </Select>
              </Field>
            </div>
            {f.paid === "yes" && (
              <Field label="Days a year" htmlFor={`${id}-d`} hint="Half days are allowed, like 7.5.">
                <Input id={`${id}-d`} type="number" min={0} max={366} step={0.5} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={pending || !f.name.trim() || !f.code.trim()}>{pending ? "Saving…" : editing ? "Save changes" : "Add"}</Button>
              {editing && <Button variant="subtle" onClick={reset} disabled={pending}>Cancel</Button>}
            </div>
            {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
          </CardBody>
        </Card>
      )}
      {!canEdit && msg && <p className="text-[13px]">{msg.text}</p>}
    </div>
  );
}
