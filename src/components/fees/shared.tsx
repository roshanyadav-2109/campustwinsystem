// Types and small helpers shared by the Fees page, its data layer and its
// client components. Nothing here touches the server or the browser.
import type { PdfDoc } from "@/lib/pdf";
import type { Status } from "@/components/ui/status";

export type FeeMode = "cash" | "upi" | "card" | "bank" | "cheque" | "loan";
export type InvoiceStatus = "due" | "part" | "paid" | "cancelled";

export const FEE_MODES: FeeMode[] = ["cash", "upi", "card", "bank", "cheque", "loan"];
export const MODE_LABEL: Record<FeeMode, string> = {
  cash: "Cash", upi: "UPI", card: "Card", bank: "Bank transfer", cheque: "Cheque", loan: "Education loan",
};

export type FeeHead = { id: number; name: string; is_active: boolean; charge: "split" | "once"; is_tuition: boolean };
export type FeeLetterContent = {
  student: { name: string; admissionNo: string; dob: string | null; classLabel: string };
  parents: string[];
  year: { name: string; start: string; end: string };
  heads: { name: string; amount: number; tuition: boolean }[];
  transport: { label: string; amount: number } | null;
  concessions: { name: string; amount: number }[];
  total: number; paid: number; balance: number;
  instalments: { name: string; dueDate: string; amount: number }[];
};
export type FeeLetterPurpose = "education_loan" | "visa" | "scholarship" | "employer" | "other";
export const PURPOSE_LABEL: Record<FeeLetterPurpose, string> = {
  education_loan: "Education loan", visa: "Visa or passport", scholarship: "Scholarship", employer: "Employer reimbursement", other: "Something else",
};
export type FeeLetterRequest = {
  id: number; studentId: number; studentName: string; classLabel: string; purpose: FeeLetterPurpose; addressedTo: string | null; note: string | null;
  requestedName: string | null; status: "pending" | "issued" | "declined"; officeNote: string | null; letterNo: string | null;
  content: FeeLetterContent | null; createdAt: string; decidedAt: string | null;
};
export type LateRule = { enabled: boolean; grace_days: number; kind: "once" | "per_week" | "per_month"; amount: number; max_amount: number | null; applies_from: string | null };
export type Instalment = { id: number; seq: number; name: string; due_date: string; share_pct: number; raised: number };
export type ConcessionType = { id: number; name: string; kind: "percent" | "amount"; value: number; head_ids: number[] | null; auto_rule: "sibling" | null; active: boolean };
export type StudentConcession = { id: number; typeId: number; name: string; detail: string; isAuto: boolean; note: string | null };
export type StructureRow = { class_id: number; fee_head_id: number; amount: number };

// A line on an invoice. Concessions are shown as negative amounts; a waived
// late fee is shown with a zero amount and "(waived)".
export type FeeLine = { name: string; amount: number };

export type InvoiceView = {
  id: number;
  studentId: number;
  title: string;
  amount: number;
  paid: number;
  balance: number;
  dueDate: string;
  status: InvoiceStatus;
  overdue: boolean;
  lines: FeeLine[];
};

// Everything a printed receipt needs.
export type ReceiptData = {
  receiptNo: string;
  paidOn: string;
  studentName: string;
  admissionNo: string;
  classLabel: string;
  invoiceTitle: string;
  invoiceAmount: number;
  lines: FeeLine[];
  amount: number;
  mode: FeeMode;
  reference: string | null;
  note: string | null;
  isRefund: boolean;
};

export type PaymentView = ReceiptData & { id: number; invoiceId: number; studentId: number };

export type StudentBrief = { id: number; name: string; admissionNo: string; classLabel: string };

export type DueRow = {
  studentId: number;
  name: string;
  admissionNo: string;
  classLabel: string;
  invoices: number;
  pending: number;
  daysOverdue: number;
  items: { title: string; dueDate: string; balance: number }[];
  oldestDue: string;
  overdue: boolean;
};

export type FeeOverview = {
  collected: number;
  pending: number;
  overdueCount: number;
  overdueAmount: number;
  billed: number;
  byMode: { mode: FeeMode; amount: number; count: number }[];
  byClass: { classId: number | null; name: string; billed: number; collected: number; pending: number }[];
};

// Money is kept to two decimals; add and compare in paise to avoid float drift.
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// "₹ 12,500" (paise shown only when there are any).
export function fmtMoney(n: number): string {
  const v = round2(n);
  const text = Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "-" : ""}₹ ${text}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-02-26" -> "26 Feb 2026". Read as a plain calendar date, never shifted by time zone.
export function fmtDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "-";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

// Today's date in school time (India), as YYYY-MM-DD.
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function statusOf(amount: number, paid: number): Exclude<InvoiceStatus, "cancelled"> {
  const a = Math.round(amount * 100), p = Math.round(paid * 100);
  if (p <= 0) return a <= 0 ? "paid" : "due";
  return p >= a ? "paid" : "part";
}

export function statusLabel(inv: { status: InvoiceStatus; overdue: boolean }): { text: string; tone: Status } {
  if (inv.status === "paid") return { text: "Paid", tone: "up" };
  if (inv.status === "cancelled") return { text: "Cancelled", tone: "flat" };
  if (inv.overdue) return { text: inv.status === "part" ? "Part paid, overdue" : "Overdue", tone: "down" };
  if (inv.status === "part") return { text: "Part paid", tone: "watch" };
  return { text: "Due", tone: "flat" };
}

// The PDF's built-in fonts have no rupee sign, so receipts print "Rs.".
const pdfMoney = (n: number) =>
  `Rs. ${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A receipt as a printable document; the school letterhead is added by the PDF writer.
export function receiptPdf(r: ReceiptData): PdfDoc {
  const lines = r.lines.length ? r.lines : [{ name: r.invoiceTitle, amount: r.invoiceAmount }];
  const payment: [string, string][] = [
    [r.isRefund ? "Amount refunded" : "Amount received", pdfMoney(r.amount)],
    ["Mode", MODE_LABEL[r.mode] ?? r.mode],
    ["Date", fmtDay(r.paidOn)],
  ];
  if (r.reference) payment.push(["Reference", r.reference]);
  if (r.note) payment.push(["Note", r.note]);
  return {
    filename: `Receipt ${r.receiptNo}`,
    title: r.isRefund ? "Fee refund receipt" : "Fee receipt",
    meta: [`Receipt no. ${r.receiptNo}`, `Date: ${fmtDay(r.paidOn)}`],
    blocks: [
      { kind: "facts", items: [
        ["Student", r.studentName],
        ["Admission no.", r.admissionNo],
        ["Class", r.classLabel],
        ["Towards", r.invoiceTitle],
      ] },
      { kind: "table", heading: "Fee details", headers: ["Fee head", "Amount"], right: [1],
        rows: [...lines.map((l) => [l.name, pdfMoney(l.amount)]), ["Total billed", pdfMoney(r.invoiceAmount)]] },
      { kind: "facts", heading: r.isRefund ? "Refund" : "Payment", items: payment },
      { kind: "text", lines: ["This is a computer generated receipt."] },
    ],
  };
}

// Table look shared by every fees list.
export const TH = "pb-2 pr-3 text-left text-[12px] font-semibold text-muted";
export const TH_R = "pb-2 pl-3 text-right text-[12px] font-semibold text-muted";
export const TD = "py-2 pr-3 text-ink-700";
export const TD_R = "py-2 pl-3 text-right tabular text-ink-900";

// A fee letter as a printable document (letterhead added by the PDF writer).
export function feeLetterPdf(r: { letterNo: string; issuedOn: string; purpose: FeeLetterPurpose; addressedTo: string | null; content: FeeLetterContent }): PdfDoc {
  const c = r.content;
  const rows: [string, string][] = c.heads.map((h) => [h.name, pdfMoney(h.amount)]);
  if (c.transport) rows.push([c.transport.label, pdfMoney(c.transport.amount)]);
  for (const k of c.concessions) rows.push([`Less: ${k.name}`, `- ${pdfMoney(k.amount)}`]);
  rows.push(["Total fees for the year", pdfMoney(c.total)]);
  const purpose = r.purpose === "education_loan" ? "an education loan" : r.purpose === "visa" ? "a visa or passport application" : r.purpose === "scholarship" ? "a scholarship application" : r.purpose === "employer" ? "reimbursement by the employer" : "the purpose stated by the parent";
  const span = c.year.start && c.year.end ? ` (${fmtDay(c.year.start)} to ${fmtDay(c.year.end)})` : "";
  return {
    filename: `Fee letter ${r.letterNo} ${c.student.name}`,
    title: "Fee letter",
    meta: [`Letter no. ${r.letterNo}`, `Date: ${fmtDay(r.issuedOn)}`],
    blocks: [
      ...(r.addressedTo ? [{ kind: "text" as const, lines: ["To,", "The Manager,", r.addressedTo] }] : [{ kind: "text" as const, lines: ["To whom it may concern"] }]),
      { kind: "text", lines: [`This is to certify that ${c.student.name}${c.parents.length ? `, child of ${c.parents.join(" and ")},` : ""} is a student of class ${c.student.classLabel} in the academic year ${c.year.name}${span}. The fees for the year are as follows. This letter is issued at the parent's request for ${purpose}.`] },
      { kind: "facts", items: [["Student", c.student.name], ["Admission no.", c.student.admissionNo], ["Class", c.student.classLabel], ...(c.student.dob ? [["Date of birth", fmtDay(c.student.dob)] as [string, string]] : [])] },
      { kind: "table", heading: `Fees for ${c.year.name}`, headers: ["Fee", "Amount"], right: [1], rows },
      ...(c.instalments.length ? [{ kind: "table" as const, heading: "When the fees are due", headers: ["Instalment", "Due date", "Amount"], right: [2], rows: c.instalments.map((i) => [i.name, fmtDay(i.dueDate), pdfMoney(i.amount)]) }] : []),
      { kind: "facts", heading: "Paid so far", items: [["Paid this year", pdfMoney(c.paid)], ["Still to pay", pdfMoney(c.balance)]] },
      { kind: "text", lines: ["Payments may be made to the school's account. Please quote the student's admission number with every payment.", "", "Principal / Accounts office"] },
    ],
  };
}
