"use client";
import { useMemo, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/students/student-form";
import { cancelInvoice, raiseFees, recordPayment, saveFeeHead, saveFeeStructure, waiveLateFee } from "@/app/dashboard/fees/actions";
import { FEE_MODES, MODE_LABEL, fmtMoney, todayIST, type FeeHead, type FeeMode, type InvoiceView, type StructureRow } from "@/components/fees/shared";

type ClassOpt = { id: number; name: string };
type SectionOpt = { id: number; name: string; class_id: number };

const ERR = "text-[13px] text-down";
const OK = "text-[13px] font-medium text-up";

// ---------------------------------------------------------------------------
// Fee setup: the list of fee heads
// ---------------------------------------------------------------------------
export function FeeHeadsManager({ heads }: { heads: FeeHead[] }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (input: { id?: number; name: string; isActive: boolean }, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await saveFeeHead(input);
      if (res.ok) after?.(); else setError(res.error);
    });
  };

  return (
    <Card>
      <CardHeader title="Fee heads" />
      <CardBody className="space-y-3">
        {heads.length === 0 && <p className="text-[13px] text-ink-500">No fee heads yet. Add the first one below.</p>}
        <ul>
          {heads.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hair py-2">
              {editing?.id === h.id ? (
                <Input className="h-8 max-w-56" value={editing.name} maxLength={60} aria-label="Fee head name"
                  onChange={(e) => setEditing({ id: h.id, name: e.target.value })} />
              ) : (
                <span className={`text-[14px] ${h.is_active ? "text-ink-900" : "text-muted line-through"}`}>{h.name}</span>
              )}
              <div className="flex gap-2">
                {editing?.id === h.id ? (
                  <>
                    <Button size="sm" disabled={pending || !editing.name.trim()}
                      onClick={() => run({ id: h.id, name: editing.name, isActive: h.is_active }, () => setEditing(null))}>Save</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing({ id: h.id, name: h.name })}>Rename</Button>
                    <Button size="sm" variant="ghost" disabled={pending}
                      onClick={() => run({ id: h.id, name: h.name, isActive: !h.is_active })}>{h.is_active ? "Switch off" : "Switch on"}</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="New fee head">
              <Input value={name} maxLength={60} placeholder="For example, Library" onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button disabled={pending || !name.trim()} onClick={() => run({ name, isActive: true }, () => setName(""))}>Add</Button>
        </div>
        {error && <p role="alert" className={ERR}>{error}</p>}
        <p className="text-[12px] text-muted">A head that is switched off is left out of new invoices. Past invoices keep it.</p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fee setup: amount per class per head
// ---------------------------------------------------------------------------
export function FeeStructureGrid({ classes, heads, structure, yearName }: { classes: ClassOpt[]; heads: FeeHead[]; structure: StructureRow[]; yearName: string }) {
  const saved = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of structure) m[`${r.class_id}:${r.fee_head_id}`] = String(r.amount);
    return m;
  }, [structure]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const valueOf = (k: string) => values[k] ?? saved[k] ?? "";
  const changed = Object.keys(values).filter((k) => (values[k].trim() || "0") !== (saved[k] ?? "0"));
  const rowTotal = (classId: number) => heads.reduce((n, h) => n + (Number(valueOf(`${classId}:${h.id}`)) || 0), 0);

  function save() {
    setError(null); setDone(false);
    const entries: { classId: number; headId: number; amount: number }[] = [];
    for (const k of changed) {
      const [classId, headId] = k.split(":").map(Number);
      const amount = Number(values[k].trim() || "0");
      if (!Number.isFinite(amount) || amount < 0) { setError("Enter each amount as a number, zero or more."); return; }
      entries.push({ classId, headId, amount });
    }
    start(async () => {
      const res = await saveFeeStructure(entries);
      if (res.ok) { setValues({}); setDone(true); setTimeout(() => setDone(false), 2500); } else setError(res.error);
    });
  }

  return (
    <Card>
      <CardHeader eyebrow="Amounts by class" title={yearName} />
      <CardBody>
        {heads.length === 0 ? (
          <p className="text-[13px] text-ink-500">Add a fee head first, then set its amount for each class.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr>
                    <th className="pb-2 pr-3 text-left text-[12px] font-semibold text-muted">Class</th>
                    {heads.map((h) => (<th key={h.id} className="pb-2 pr-3 text-left text-[12px] font-semibold text-muted">{h.name}</th>))}
                    <th className="pb-2 pl-3 text-right text-[12px] font-semibold text-muted">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.id} className="border-t border-hair">
                      <td className="py-1.5 pr-3 font-medium text-ink-900">{c.name}</td>
                      {heads.map((h) => {
                        const k = `${c.id}:${h.id}`;
                        return (
                          <td key={h.id} className="py-1.5 pr-3">
                            <Input className="h-8 w-28 tabular" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0"
                              aria-label={`${h.name} for class ${c.name}`} value={valueOf(k)}
                              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
                          </td>
                        );
                      })}
                      <td className="py-1.5 pl-3 text-right tabular text-ink-900">{fmtMoney(rowTotal(c.id))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={save} disabled={pending || changed.length === 0}>{pending ? "Saving" : "Save amounts"}</Button>
              {done && <span className={OK}>Saved</span>}
              {error && <span role="alert" className={ERR}>{error}</span>}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Raise fees
// ---------------------------------------------------------------------------
export function RaiseFeesForm({ classes, sections, classTotals }: { classes: ClassOpt[]; sections: SectionOpt[]; classTotals: Record<number, number> }) {
  const [classId, setClassId] = useState<number | "">("");
  const [sectionId, setSectionId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [pending, start] = useTransition();

  const classSections = sections.filter((s) => s.class_id === classId);
  const perStudent = classId === "" ? 0 : classTotals[classId] ?? 0;

  function submit() {
    if (classId === "") return;
    setError(null); setResult(null);
    start(async () => {
      const res = await raiseFees({ classId, sectionId: sectionId === "" ? null : sectionId, title, dueDate });
      if (res.ok) setResult({ created: res.created, skipped: res.skipped }); else setError(res.error);
    });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader eyebrow="Without instalments" title="Raise a class's full fees as one bill" />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-500">Creates one invoice for every enrolled student, using the amounts in Fee setup. Students who already have an invoice with the same title this year are skipped.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Class">
            <Select value={classId} onChange={(e) => { setClassId(e.target.value ? Number(e.target.value) : ""); setSectionId(""); setResult(null); }}>
              <option value="">Choose a class</option>
              {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </Select>
          </Field>
          <Field label="Section">
            <Select value={sectionId} disabled={classId === ""} onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">All sections</option>
              {classSections.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </Select>
          </Field>
          <Field label="Title">
            <Input value={title} maxLength={80} placeholder="Term 1 fees" onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        {classId !== "" && (
          perStudent > 0
            ? <p className="text-[13px] text-ink-700">Each student will be billed <span className="font-semibold tabular text-ink-900">{fmtMoney(perStudent)}</span>.</p>
            : <p className={ERR}>No amounts are set for this class yet. Set them in Fee setup first.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={pending || classId === "" || !title.trim() || !dueDate || perStudent <= 0}>{pending ? "Creating invoices" : "Raise fees"}</Button>
          {error && <span role="alert" className={ERR}>{error}</span>}
        </div>
        {result && (
          <p role="status" className="rounded-sm border border-hair bg-panel px-3 py-2 text-[13px] text-ink-900">
            {result.created === 1 ? "1 invoice created." : `${result.created} invoices created.`}
            {result.skipped > 0 && ` ${result.skipped} skipped because ${result.skipped === 1 ? "the student already has" : "those students already have"} this invoice.`}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Collect: buttons on each invoice row
// ---------------------------------------------------------------------------
export function InvoiceActions({ invoice }: { invoice: InvoiceView }) {
  const [open, setOpen] = useState<"pay" | "refund" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  if (invoice.status === "cancelled") return null;
  const hasLateFee = invoice.lines.some((l) => l.name === "Late fee" && l.amount > 0);
  const waive = () => {
    setError(null);
    start(async () => {
      const res = await waiveLateFee({ invoiceId: invoice.id, reason });
      if (res.ok) { setWaiving(false); setReason(""); } else setError(res.error);
    });
  };

  const cancel = () => {
    if (!window.confirm(`Cancel "${invoice.title}"? The student will no longer be asked to pay it.`)) return;
    setError(null);
    start(async () => { const res = await cancelInvoice(invoice.id); if (!res.ok) setError(res.error); });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {invoice.balance > 0 && <Button size="sm" onClick={() => setOpen("pay")}>Record payment</Button>}
        {invoice.paid > 0 && <Button size="sm" variant="subtle" onClick={() => setOpen("refund")}>Refund</Button>}
        {invoice.paid <= 0 && <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}>Cancel invoice</Button>}
        {hasLateFee && invoice.balance > 0 && !waiving && <Button size="sm" variant="ghost" onClick={() => setWaiving(true)}>Waive late fee</Button>}
      </div>
      {waiving && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input className="h-8 w-56" aria-label="Reason for waiving the late fee" placeholder="Reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" disabled={pending || !reason.trim()} onClick={waive}>Waive</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setWaiving(false)}>Cancel</Button>
        </div>
      )}
      {error && <span role="alert" className="text-[12px] text-down">{error}</span>}
      {open && <PaymentDialog invoice={invoice} refund={open === "refund"} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PaymentDialog({ invoice, refund, onClose }: { invoice: InvoiceView; refund: boolean; onClose: () => void }) {
  const limit = refund ? invoice.paid : invoice.balance;
  const [amount, setAmount] = useState(refund ? "" : String(limit));
  const [mode, setMode] = useState<FeeMode>("cash");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(todayIST());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const value = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(value) && value > 0 && value <= limit && !!paidOn;

  function submit() {
    setError(null);
    start(async () => {
      const res = await recordPayment({ invoiceId: invoice.id, amount: value, mode, reference, paidOn, note, isRefund: refund });
      if (res.ok) setReceipt(res.receiptNo); else setError(res.error);
    });
  }

  return (
    <Dialog title={refund ? "Record a refund" : "Record a payment"} onClose={onClose}>
      {receipt ? (
        <div className="space-y-4 text-left">
          <p className="text-[14px] text-ink-900">
            {refund ? "Refund recorded." : "Payment recorded."} Receipt number <span className="font-semibold tabular">{receipt}</span>.
          </p>
          <p className="text-[13px] text-ink-500">The receipt can be downloaded from the payment history below.</p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-3 text-left">
          <p className="text-[13px] text-ink-500">
            {invoice.title}. {refund ? `Paid so far ${fmtMoney(invoice.paid)}.` : `Balance ${fmtMoney(invoice.balance)} of ${fmtMoney(invoice.amount)}.`}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={refund ? "Refund amount" : "Amount received"} hint={`Up to ${fmtMoney(limit)}`}>
              <Input type="number" min={0} max={limit} step="0.01" inputMode="decimal" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Date">
              <Input type="date" value={paidOn} max={todayIST()} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="Mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value as FeeMode)}>
                {FEE_MODES.map((m) => (<option key={m} value={m}>{MODE_LABEL[m]}</option>))}
              </Select>
            </Field>
            <Field label="Reference" hint="UPI, cheque or bank reference, if any">
              <Input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
          <Field label={refund ? "Reason for refund" : "Note"}>
            <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <p role="alert" className={ERR}>{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button onClick={submit} disabled={pending || !valid}>{pending ? "Saving" : refund ? "Record refund" : "Record payment"}</Button>
            <Button variant="ghost" onClick={onClose} disabled={pending}>Close</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
