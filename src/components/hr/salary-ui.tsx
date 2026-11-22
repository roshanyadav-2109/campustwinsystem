"use client";
import { useCallback, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Dialog } from "@/components/students/student-form";
import { saveSalary } from "@/app/dashboard/hr/actions";
import { fmtDate, fmtMoney, roleLabel } from "@/components/hr/format";

export type SalaryRow = {
  staffId: number;
  name: string;
  role: string;
  code: string | null;
  salary: {
    basic: number; hra: number; da: number; otherAllowance: number;
    pfDeduction: number; taxDeduction: number; otherDeduction: number;
    bankName: string | null; accountLast4: string | null; effectiveFrom: string;
  } | null;
};

const AMOUNTS = [
  ["basic", "Basic pay"],
  ["hra", "House rent allowance"],
  ["da", "Dearness allowance"],
  ["otherAllowance", "Other allowances"],
  ["pfDeduction", "Provident fund"],
  ["taxDeduction", "Tax"],
  ["otherDeduction", "Other deductions"],
] as const;
type AmountKey = (typeof AMOUNTS)[number][0];

const toNum = (s: string) => { const x = Number(s); return s.trim() !== "" && Number.isFinite(x) ? x : 0; };

function SalaryForm({ row, today, onDone, onCancel }: { row: SalaryRow; today: string; onDone: () => void; onCancel: () => void }) {
  const id = useId();
  const s = row.salary;
  const [v, setV] = useState<Record<AmountKey, string>>({
    basic: s ? String(s.basic) : "", hra: s ? String(s.hra) : "", da: s ? String(s.da) : "",
    otherAllowance: s ? String(s.otherAllowance) : "", pfDeduction: s ? String(s.pfDeduction) : "",
    taxDeduction: s ? String(s.taxDeduction) : "", otherDeduction: s ? String(s.otherDeduction) : "",
  });
  const [bankName, setBankName] = useState(s?.bankName ?? "");
  const [last4, setLast4] = useState(s?.accountLast4 ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(s?.effectiveFrom ?? today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Shown as a guide only; the server works out the real figures.
  const gross = toNum(v.basic) + toNum(v.hra) + toNum(v.da) + toNum(v.otherAllowance);
  const deductions = toNum(v.pfDeduction) + toNum(v.taxDeduction) + toNum(v.otherDeduction);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (last4 && !/^\d{4}$/.test(last4)) { setError("Enter only the last 4 digits of the account number."); return; }
    if (!effectiveFrom) { setError("Enter the date this salary applies from."); return; }
    start(async () => {
      const res = await saveSalary({
        staffId: row.staffId,
        basic: toNum(v.basic), hra: toNum(v.hra), da: toNum(v.da), otherAllowance: toNum(v.otherAllowance),
        pfDeduction: toNum(v.pfDeduction), taxDeduction: toNum(v.taxDeduction), otherDeduction: toNum(v.otherDeduction),
        bankName, accountLast4: last4, effectiveFrom,
      });
      if (!res.ok) { setError(res.error); return; }
      onDone();
    });
  }

  const amount = (key: AmountKey, label: string) => (
    <Field key={key} label={label} htmlFor={`${id}-${key}`}>
      <Input id={`${id}-${key}`} inputMode="decimal" value={v[key]} maxLength={12} placeholder="0"
        onChange={(e) => setV((p) => ({ ...p, [key]: e.target.value.replace(/[^\d.]/g, "") }))} />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate>
      <p className="text-[13px] text-ink-500">{roleLabel(row.role)}{row.code ? `, employee code ${row.code}` : ""}. All amounts are per month, in rupees.</p>
      <h3 className="t-h3 mt-4 text-ink-900">Earnings</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{AMOUNTS.slice(0, 4).map(([k, l]) => amount(k, l))}</div>
      <h3 className="t-h3 mt-6 text-ink-900">Deductions</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{AMOUNTS.slice(4).map(([k, l]) => amount(k, l))}</div>
      <h3 className="t-h3 mt-6 text-ink-900">Bank and start date</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Bank name" htmlFor={`${id}-bank`}>
          <Input id={`${id}-bank`} value={bankName} maxLength={80} onChange={(e) => setBankName(e.target.value)} />
        </Field>
        <Field label="Account number, last 4 digits" htmlFor={`${id}-acc`} hint="The full account number is never stored.">
          <Input id={`${id}-acc`} inputMode="numeric" value={last4} maxLength={4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </Field>
        <Field label="Applies from" htmlFor={`${id}-from`} hint="Payroll for earlier months leaves this person out.">
          <Input id={`${id}-from`} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
      </div>
      <p className="mt-4 text-[13px] text-ink-700">
        Total earnings <span className="tabular font-semibold text-ink-900">{fmtMoney(gross)}</span>, deductions{" "}
        <span className="tabular font-semibold text-ink-900">{fmtMoney(deductions)}</span>, take-home before unpaid leave{" "}
        <span className="tabular font-semibold text-ink-900">{fmtMoney(Math.round((gross - deductions) * 100) / 100)}</span>.
      </p>
      {error && <p role="alert" className="mt-3 text-[13px] font-medium text-down">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving" : "Save salary"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}

// Every staff member with their salary structure. The office edits in a
// dialog; the principal sees the same list without the buttons.
export function SalaryTable({ rows, canEdit, today }: { rows: SalaryRow[]; canEdit: boolean; today: string }) {
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<SalaryRow | null>(null);
  const close = useCallback(() => setEditing(null), []);

  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.name} ${r.code ?? ""} ${roleLabel(r.role)}`.toLowerCase().includes(q)) : rows;

  return (
    <div>
      <div className="mb-3 max-w-sm">
        <Input aria-label="Find a staff member" placeholder="Find by name, code or role" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[14px]">
          <thead>
            <tr className="border-b border-hair text-left text-[12px] text-ink-700">
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="py-2 pr-3 font-semibold">Role</th>
              <th className="py-2 pr-3 text-right font-semibold">Earnings</th>
              <th className="py-2 pr-3 text-right font-semibold">Deductions</th>
              <th className="py-2 pr-3 text-right font-semibold">Take-home</th>
              <th className="py-2 pr-3 font-semibold">Bank</th>
              <th className="py-2 pr-3 font-semibold">Applies from</th>
              {canEdit && <th className="py-2"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const s = r.salary;
              const gross = s ? s.basic + s.hra + s.da + s.otherAllowance : 0;
              const ded = s ? s.pfDeduction + s.taxDeduction + s.otherDeduction : 0;
              return (
                <tr key={r.staffId} className="border-b border-hair last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-ink-900">{r.name}</div>
                    {r.code && <div className="text-[12px] text-ink-500">{r.code}</div>}
                  </td>
                  <td className="py-2 pr-3 text-ink-900">{roleLabel(r.role)}</td>
                  {s ? (
                    <>
                      <td className="py-2 pr-3 text-right tabular text-ink-900">{fmtMoney(Math.round(gross * 100) / 100)}</td>
                      <td className="py-2 pr-3 text-right tabular text-ink-900">{fmtMoney(Math.round(ded * 100) / 100)}</td>
                      <td className="py-2 pr-3 text-right tabular font-semibold text-ink-900">{fmtMoney(Math.round((gross - ded) * 100) / 100)}</td>
                      <td className="py-2 pr-3 text-ink-900">
                        {s.bankName || s.accountLast4 ? `${s.bankName ?? "Account"}${s.accountLast4 ? ` ending ${s.accountLast4}` : ""}` : "-"}
                      </td>
                      <td className="py-2 pr-3 text-ink-900">{fmtDate(s.effectiveFrom)}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="py-2 pr-3 text-ink-500">No salary set up yet</td>
                  )}
                  {canEdit && (
                    <td className="py-2 text-right">
                      <Button size="sm" variant="subtle" onClick={() => setEditing(r)}>{s ? "Edit" : "Set up"}</Button>
                    </td>
                  )}
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={canEdit ? 8 : 7} className="py-6 text-center text-ink-500">{rows.length ? "Nobody matches" : "No staff found"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <Dialog title={`Salary: ${editing.name}`} onClose={close}>
          <SalaryForm key={editing.staffId} row={editing} today={today} onDone={close} onCancel={close} />
        </Dialog>
      )}
    </div>
  );
}
