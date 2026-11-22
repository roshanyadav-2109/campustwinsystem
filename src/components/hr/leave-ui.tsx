"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { applyStaffLeave, cancelStaffLeave, decideStaffLeave } from "@/app/dashboard/hr/actions";

export type LeaveTypeOption = { id: number; name: string; code: string; isPaid: boolean; remaining: number };

// Apply for leave. The server works out the days and checks the balance; the
// figures here are only a guide.
export function ApplyLeaveForm({ types }: { types: LeaveTypeOption[] }) {
  const id = useId();
  const [typeId, setTypeId] = useState<number>(types[0]?.id ?? 0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const type = types.find((t) => t.id === typeId);
  const oneDay = !!from && (!to || to === from);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setDone(false);
    const last = to || from;
    if (!typeId) { setError("Choose a leave type."); return; }
    if (!from) { setError("Enter the first day of the leave."); return; }
    if (last < from) { setError("The last day cannot be before the first day."); return; }
    if (reason.trim().length < 3) { setError("Give a short reason for the leave."); return; }
    start(async () => {
      const res = await applyStaffLeave({ typeId, fromDate: from, toDate: last, halfDay: halfDay && oneDay, reason });
      if (!res.ok) { setError(res.error); return; }
      setFrom(""); setTo(""); setReason(""); setHalfDay(false); setDone(true);
      setTimeout(() => setDone(false), 3000);
    });
  }

  return (
    <Card>
      <CardHeader title="Apply for leave" />
      <CardBody>
        <form onSubmit={submit} noValidate className="space-y-3">
          <Field label="Leave type" htmlFor={`${id}-type`}
            hint={type ? (type.isPaid ? `${type.remaining} day(s) left this year.` : "Unpaid. Pay is reduced for these days.") : undefined}>
            <Select id={`${id}-type`} value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor={`${id}-from`}>
              <Input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor={`${id}-to`}>
              <Input id={`${id}-to`} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <label className={`flex items-center gap-2 text-[14px] ${oneDay ? "text-ink-900" : "text-muted"}`}>
            <input type="checkbox" className="h-4 w-4" checked={halfDay && oneDay} disabled={!oneDay}
              onChange={(e) => setHalfDay(e.target.checked)} />
            Half day (single date only)
          </label>
          <Field label="Reason" htmlFor={`${id}-reason`}>
            <Textarea id={`${id}-reason`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <p className="text-[12px] text-muted">Sundays are not counted as leave.</p>
          {error && <p role="alert" className="text-[13px] font-medium text-down">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || !types.length}>{pending ? "Sending" : "Send request"}</Button>
            {done && <span className="text-[13px] font-medium text-up">Request sent</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// Withdraw a request that has not been decided yet.
export function CancelLeaveButton({ id }: { id: number }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      const res = await cancelStaffLeave(id);
      if (!res.ok) setError(res.error);
      setConfirm(false);
    });
  }

  if (error) return <span role="alert" className="text-[12px] text-down">{error}</span>;
  if (!confirm) return <Button size="sm" variant="subtle" onClick={() => setConfirm(true)}>Cancel request</Button>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="text-[13px] text-ink-700">Cancel it?</span>
      <Button size="sm" variant="danger" disabled={pending} onClick={run}>Yes, cancel</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>No</Button>
    </span>
  );
}

// Approve or reject a pending request, with an optional note to the staff member.
export function LeaveDecision({ id }: { id: number }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(status: "approved" | "rejected") {
    setError(null);
    start(async () => {
      const res = await decideStaffLeave(id, status, note);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Note (optional)" placeholder="Note (optional)" className="h-8 max-w-xs text-[13px]"
          maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" disabled={pending} onClick={() => decide("approved")}>Approve</Button>
        <Button size="sm" variant="subtle" disabled={pending} onClick={() => decide("rejected")}>Reject</Button>
      </div>
      {error && <p role="alert" className="text-[12px] font-medium text-down">{error}</p>}
    </div>
  );
}
