import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status";
import { ReceiptButton } from "@/components/fees/fees-downloads";
import {
  MODE_LABEL, TD, TD_R, TH, TH_R, fmtDay, fmtMoney, statusLabel,
  type FeeOverview, type InvoiceView, type PaymentView,
} from "@/components/fees/shared";

const SEG_ON = "border-[#0F6CBD] bg-[#EBF3FC] text-[#0F6CBD] font-semibold";
const SEG_OFF = "border-hair bg-surface text-ink-700 hover:border-[#B4D6FA] hover:bg-[#F5F9FE]";

// A row of links that switch what the page shows (views, or a guardian's children).
export function SegLinks({ items, label }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="seg mb-5 flex flex-wrap gap-2">
      {items.map((i) => (
        <Link prefetch={false} key={i.href} href={i.href} aria-current={i.active ? "page" : undefined}
          className={`rounded-sm border px-3 py-1.5 text-[13px] font-medium ${i.active ? SEG_ON : SEG_OFF}`}>{i.label}</Link>
      ))}
    </nav>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardBody>
        <div className="t-label">{label}</div>
        <div className="mt-1 text-[26px] font-bold leading-tight tabular text-ink-900">{value}</div>
        {note && <div className="mt-1 text-[13px] text-ink-500">{note}</div>}
      </CardBody>
    </Card>
  );
}

export function OverviewView({ data, yearName }: { data: FeeOverview; yearName: string }) {
  const modeTotal = data.byMode.reduce((n, m) => n + m.amount, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Collected this year" value={fmtMoney(data.collected)} note={`Of ${fmtMoney(data.billed)} billed in ${yearName}`} />
        <Stat label="Pending" value={fmtMoney(data.pending)} />
        <Stat label="Overdue invoices" value={String(data.overdueCount)} note={data.overdueCount ? `${fmtMoney(data.overdueAmount)} past the due date` : "Nothing is past its due date"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Collected and pending by class" />
          <CardBody>
            {data.byClass.length === 0 ? (
              <p className="text-[13px] text-ink-500">No fees have been raised this year.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead><tr>
                    <th className={TH}>Class</th><th className={TH_R}>Billed</th><th className={TH_R}>Collected</th><th className={TH_R}>Pending</th>
                  </tr></thead>
                  <tbody>
                    {data.byClass.map((c) => (
                      <tr key={c.classId ?? "other"} className="border-t border-hair">
                        <td className={`${TD} font-medium text-ink-900`}>{c.name}</td>
                        <td className={TD_R}>{fmtMoney(c.billed)}</td>
                        <td className={TD_R}>{fmtMoney(c.collected)}</td>
                        <td className={TD_R}>{fmtMoney(c.pending)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-hair font-semibold">
                      <td className={`${TD} text-ink-900`}>Whole school</td>
                      <td className={TD_R}>{fmtMoney(data.billed)}</td>
                      <td className={TD_R}>{fmtMoney(data.byClass.reduce((n, c) => n + c.collected, 0))}</td>
                      <td className={TD_R}>{fmtMoney(data.pending)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
        <Card className="self-start">
          <CardHeader title="Collection by payment mode" />
          <CardBody>
            {data.byMode.length === 0 ? (
              <p className="text-[13px] text-ink-500">No payments have been recorded this year.</p>
            ) : (
              <table className="w-full text-[14px]">
                <thead><tr><th className={TH}>Mode</th><th className={TH_R}>Entries</th><th className={TH_R}>Amount</th></tr></thead>
                <tbody>
                  {data.byMode.map((m) => (
                    <tr key={m.mode} className="border-t border-hair">
                      <td className={TD}>{MODE_LABEL[m.mode]}</td>
                      <td className={TD_R}>{m.count}</td>
                      <td className={TD_R}>{fmtMoney(m.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-hair font-semibold">
                    <td className={`${TD} text-ink-900`}>Total</td><td className={TD_R} /><td className={TD_R}>{fmtMoney(modeTotal)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="mt-3 text-[12px] text-muted">Refunds are taken off the mode they were paid back by.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// Invoices of one student. `action` adds the office's buttons at the end of a row.
export function InvoiceTable({ invoices, action }: { invoices: InvoiceView[]; action?: (inv: InvoiceView) => React.ReactNode }) {
  if (!invoices.length) return <p className="text-[13px] text-ink-500">No fees have been raised yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead><tr>
          <th className={TH}>Invoice</th><th className={TH}>Due date</th><th className={TH_R}>Amount</th>
          <th className={TH_R}>Paid</th><th className={TH_R}>Balance</th><th className={`${TH} pl-4`}>Status</th>
          {action && <th className={TH_R}><span className="sr-only">Actions</span></th>}
        </tr></thead>
        <tbody>
          {invoices.map((inv) => {
            const st = statusLabel(inv);
            return (
              <tr key={inv.id} className="border-t border-hair align-top">
                <td className={TD}>
                  <div className="font-medium text-ink-900">{inv.title}</div>
                  {inv.lines.length > 0 && (
                    <div className="mt-0.5 text-[12px] text-ink-500">{inv.lines.map((l) => `${l.name} ${fmtMoney(l.amount)}`).join(", ")}</div>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap tabular`}>{fmtDay(inv.dueDate)}</td>
                <td className={TD_R}>{fmtMoney(inv.amount)}</td>
                <td className={TD_R}>{fmtMoney(inv.paid)}</td>
                <td className={`${TD_R} font-semibold`}>{fmtMoney(inv.balance)}</td>
                <td className={`${TD} pl-4`}><StatusPill status={st.tone} className="whitespace-nowrap">{st.text}</StatusPill></td>
                {action && <td className="py-2 pl-3">{action(inv)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Payments with a receipt download. `showStudent` adds who paid (school-wide lists).
export function PaymentTable({ payments, showStudent, studentHref, empty }: {
  payments: PaymentView[]; showStudent?: boolean; studentHref?: (studentId: number) => string; empty: string;
}) {
  if (!payments.length) return <p className="text-[13px] text-ink-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead><tr>
          <th className={TH}>Receipt no.</th><th className={TH}>Date</th>
          {showStudent && <th className={TH}>Student</th>}
          <th className={TH}>Towards</th><th className={TH}>Mode</th><th className={TH_R}>Amount</th>
          <th className={TH_R}><span className="sr-only">Download</span></th>
        </tr></thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-t border-hair align-top">
              <td className={`${TD} whitespace-nowrap tabular font-medium text-ink-900`}>{p.receiptNo}</td>
              <td className={`${TD} whitespace-nowrap tabular`}>{fmtDay(p.paidOn)}</td>
              {showStudent && (
                <td className={TD}>
                  {studentHref
                    ? <Link prefetch={false} href={studentHref(p.studentId)} className="font-medium text-[#0F6CBD] hover:underline">{p.studentName}</Link>
                    : <span className="font-medium text-ink-900">{p.studentName}</span>}
                  <div className="text-[12px] text-ink-500">{[p.classLabel, p.admissionNo].filter(Boolean).join(" · ")}</div>
                </td>
              )}
              <td className={TD}>
                {p.invoiceTitle}
                {p.isRefund && <span className="ml-2 text-[12px] font-semibold text-down">Refund</span>}
                {p.reference && <div className="text-[12px] text-ink-500">Ref. {p.reference}</div>}
              </td>
              <td className={TD}>{MODE_LABEL[p.mode] ?? p.mode}</td>
              <td className={TD_R}>{fmtMoney(p.isRefund ? -p.amount : p.amount)}</td>
              <td className="py-2 pl-3 text-right"><ReceiptButton receipt={toReceipt(p)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Only what the receipt needs crosses to the browser.
function toReceipt(p: PaymentView) {
  return {
    receiptNo: p.receiptNo, paidOn: p.paidOn, studentName: p.studentName, admissionNo: p.admissionNo, classLabel: p.classLabel,
    invoiceTitle: p.invoiceTitle, invoiceAmount: p.invoiceAmount, lines: p.lines, amount: p.amount, mode: p.mode,
    reference: p.reference, note: p.note, isRefund: p.isRefund,
  };
}
