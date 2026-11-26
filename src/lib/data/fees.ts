import { createClient } from "@/lib/supabase/server";
import { untyped, getNames } from "@/lib/data/schedule";
import type { SectionOpt } from "@/lib/data/scope";
import {
  FEE_MODES, fmtMoney, round2, todayIST,
  type ConcessionType, type DueRow, type FeeHead, type Instalment, type StudentConcession, type FeeLine, type FeeMode, type FeeOverview, type InvoiceStatus,
  type InvoiceView, type PaymentView, type StructureRow, type StudentBrief,
} from "@/components/fees/shared";

// Fees data (migration 0041). The generated database types do not know these
// tables yet, so queries go through the untyped client and every result is
// cast to the row types below. Row rules decide what each caller gets back:
// the office and principal see everything, a student or guardian only their own.

type PgError = { code?: string; message?: string } | null;

// Thrown when migration 0041 has not been applied yet, so the page can say so.
export class FeesNotReady extends Error {
  constructor() { super("Fees tables are not set up yet"); }
}

function check(error: PgError) {
  if (!error) return;
  const m = (error.message ?? "").toLowerCase();
  if (error.code === "PGRST205" || error.code === "42P01" || (m.includes("fee_") && (m.includes("does not exist") || m.includes("schema cache")))) {
    throw new FeesNotReady();
  }
  throw new Error(error.message ?? "Fees query failed");
}

// The API returns at most 1000 rows per request. `build` makes the query (with
// a stable order); the first page also asks for the total, and any further
// pages are then fetched together.
const PAGE = 1000;
type PageResult = { data: unknown[] | null; error: PgError; count?: number | null };
type Ranged = { range(from: number, to: number): PromiseLike<PageResult> };

export async function fetchAll<T>(build: (withCount: boolean) => Ranged): Promise<T[]> {
  const first = await build(true).range(0, PAGE - 1);
  check(first.error);
  const rows = (first.data ?? []) as T[];
  const total = first.count ?? rows.length;
  if (total <= PAGE) return rows;
  const starts: number[] = [];
  for (let from = PAGE; from < total; from += PAGE) starts.push(from);
  const rest = await Promise.all(starts.map((from) => build(false).range(from, from + PAGE - 1)));
  for (const r of rest) { check(r.error); rows.push(...((r.data ?? []) as T[])); }
  return rows;
}

const countOpt = (withCount: boolean) => (withCount ? { count: "exact" as const } : undefined);

// Run an `in (...)` look-up in chunks so a long id list never overflows the URL.
export async function inChunks<T>(ids: number[], run: (chunk: number[]) => PromiseLike<{ data: unknown[] | null; error: PgError }>, size = 200): Promise<T[]> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return [];
  const chunks: number[][] = [];
  for (let i = 0; i < uniq.length; i += size) chunks.push(uniq.slice(i, i + size));
  const res = await Promise.all(chunks.map(run));
  const out: T[] = [];
  for (const r of res) { check(r.error); out.push(...((r.data ?? []) as T[])); }
  return out;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export async function getFeeHeads(): Promise<FeeHead[]> {
  const db = await untyped();
  const { data, error } = await db.from("fee_head").select("id, name, is_active, charge, is_tuition").order("name");
  check(error);
  return (data ?? []) as FeeHead[];
}

// The year's instalments, with how many invoices each has raised so far.
export async function getInstalments(yearId: number): Promise<Instalment[]> {
  const db = await untyped();
  const { data, error } = await db.from("fee_instalment").select("id, seq, name, due_date, share_pct").eq("academic_year_id", yearId).order("seq");
  check(error);
  const rows = (data ?? []) as { id: number; seq: number; name: string; due_date: string; share_pct: number | string }[];
  const counts = await Promise.all(rows.map((r) =>
    db.from("fee_invoice").select("id", { count: "exact", head: true }).eq("instalment_id", r.id).neq("status", "cancelled")));
  return rows.map((r, i) => ({ ...r, share_pct: Number(r.share_pct), raised: counts[i].count ?? 0 }));
}

export async function getConcessionTypes(): Promise<ConcessionType[]> {
  const db = await untyped();
  const { data, error } = await db.from("fee_concession_type").select("id, name, kind, value, head_ids, auto_rule, active").order("name");
  check(error);
  return ((data ?? []) as (ConcessionType & { value: number | string })[]).map((t) => ({ ...t, value: Number(t.value) }));
}

export const concessionDetail = (t: Pick<ConcessionType, "kind" | "value">) =>
  t.kind === "percent" ? `${t.value}% off` : `${fmtMoney(t.value)} off a year`;

export async function getStudentConcessions(studentId: number, yearId: number): Promise<StudentConcession[]> {
  const db = await untyped();
  const { data, error } = await db.from("student_concession")
    .select("id, concession_type_id, is_auto, note, fee_concession_type(name, kind, value)")
    .eq("student_id", studentId).eq("academic_year_id", yearId).eq("status", "active").order("id");
  check(error);
  return ((data ?? []) as unknown as { id: number; concession_type_id: number; is_auto: boolean; note: string | null; fee_concession_type: { name: string; kind: "percent" | "amount"; value: number | string } | null }[])
    .map((r) => ({
      id: r.id, typeId: r.concession_type_id, isAuto: r.is_auto, note: r.note,
      name: r.fee_concession_type?.name ?? "Concession",
      detail: r.fee_concession_type ? concessionDetail({ kind: r.fee_concession_type.kind, value: Number(r.fee_concession_type.value) }) : "",
    }));
}

export async function getFeeStructure(yearId: number): Promise<StructureRow[]> {
  const db = await untyped();
  const rows = await fetchAll<{ class_id: number; fee_head_id: number; amount: number | string }>((c) =>
    db.from("fee_structure").select("class_id, fee_head_id, amount", countOpt(c)).eq("academic_year_id", yearId).order("id"));
  return rows.map((r) => ({ class_id: r.class_id, fee_head_id: r.fee_head_id, amount: Number(r.amount) }));
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
type InvoiceRow = {
  id: number; student_id: number; section_id: number | null; academic_year_id: number; title: string;
  amount: number | string; paid_amount: number | string; due_date: string; status: InvoiceStatus;
};
const INVOICE_COLS = "id, student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status";

const isOpen = (s: InvoiceStatus) => s === "due" || s === "part";

function toInvoiceView(r: InvoiceRow, lines: FeeLine[], today: string): InvoiceView {
  const amount = Number(r.amount), paid = Number(r.paid_amount);
  return {
    id: r.id, studentId: r.student_id, title: r.title, amount, paid,
    balance: r.status === "cancelled" ? 0 : round2(Math.max(0, amount - paid)),
    dueDate: r.due_date, status: r.status,
    overdue: isOpen(r.status) && r.due_date < today,
    lines,
  };
}

async function getLines(invoiceIds: number[]): Promise<Map<number, FeeLine[]>> {
  const db = await untyped();
  const rows = await inChunks<{ invoice_id: number; amount: number | string; kind: string; label: string | null; waived: boolean; fee_head: { name: string } | null }>(invoiceIds, (chunk) =>
    db.from("fee_invoice_line").select("invoice_id, amount, kind, label, waived, fee_head(name)").in("invoice_id", chunk).order("id").limit(5000));
  const map = new Map<number, FeeLine[]>();
  for (const r of rows) {
    const list = map.get(r.invoice_id) ?? [];
    const base = r.fee_head?.name ?? r.label ?? (r.kind === "late_fee" ? "Late fee" : r.kind === "transport" ? "Transport" : "Fee");
    if (r.kind === "concession") list.push({ name: `Concession: ${r.label ?? "concession"}`, amount: -Number(r.amount) });
    else if (r.waived) list.push({ name: `${base} (waived)`, amount: 0 });
    else list.push({ name: base, amount: Number(r.amount) });
    map.set(r.invoice_id, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
type PaymentRow = {
  id: number; invoice_id: number; student_id: number; amount: number | string; paid_on: string; mode: FeeMode;
  reference: string | null; receipt_no: string; is_refund: boolean; note: string | null;
  fee_invoice: { title: string; amount: number | string; section_id: number | null } | null;
};
const PAYMENT_COLS = "id, invoice_id, student_id, amount, paid_on, mode, reference, receipt_no, is_refund, note, fee_invoice(title, amount, section_id)";

// Fill in the names a receipt shows: student, class and the invoice's fee heads.
async function toPaymentViews(rows: PaymentRow[], known?: StudentBrief): Promise<PaymentView[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const studentIds = known ? [] : rows.map((r) => r.student_id);
  const [lines, students, names] = await Promise.all([
    getLines(rows.map((r) => r.invoice_id)),
    inChunks<{ id: number; full_name: string; admission_no: string }>(studentIds, (chunk) =>
      supabase.from("student").select("id, full_name, admission_no").in("id", chunk)),
    getNames({ sectionIds: rows.map((r) => r.fee_invoice?.section_id ?? null) }),
  ]);
  const byStudent = new Map(students.map((s) => [s.id, s]));
  return rows.map((r) => {
    const s = byStudent.get(r.student_id);
    const secId = r.fee_invoice?.section_id ?? null;
    return {
      id: r.id, invoiceId: r.invoice_id, studentId: r.student_id,
      receiptNo: r.receipt_no, paidOn: r.paid_on,
      studentName: known?.name ?? s?.full_name ?? "Student",
      admissionNo: known?.admissionNo ?? s?.admission_no ?? "",
      classLabel: (secId ? names.section.get(secId) : undefined) ?? known?.classLabel ?? "",
      invoiceTitle: r.fee_invoice?.title ?? "Fees",
      invoiceAmount: Number(r.fee_invoice?.amount ?? 0),
      lines: lines.get(r.invoice_id) ?? [],
      amount: Number(r.amount), mode: r.mode, reference: r.reference, note: r.note, isRefund: r.is_refund,
    };
  });
}

// The latest payments across the school (office / principal).
export async function getRecentPayments(limit = 200): Promise<PaymentView[]> {
  const db = await untyped();
  const { data, error } = await db.from("fee_payment").select(PAYMENT_COLS)
    .order("paid_on", { ascending: false }).order("id", { ascending: false }).limit(Math.min(limit, PAGE));
  check(error);
  return toPaymentViews((data ?? []) as unknown as PaymentRow[]);
}

// ---------------------------------------------------------------------------
// One student: invoices and payment history
// ---------------------------------------------------------------------------
export async function getStudentBrief(studentId: number, yearId: number): Promise<StudentBrief | null> {
  const supabase = await createClient();
  const [{ data: s }, { data: enr }] = await Promise.all([
    supabase.from("student").select("id, full_name, admission_no").eq("id", studentId).maybeSingle(),
    supabase.from("student_enrollment").select("section:section_id(name, class:class_id(name))")
      .eq("student_id", studentId).eq("academic_year_id", yearId).maybeSingle(),
  ]);
  if (!s) return null;
  const sec = enr?.section as unknown as { name: string; class: { name: string } | null } | null;
  return { id: s.id, name: s.full_name, admissionNo: s.admission_no, classLabel: sec ? (sec.class ? `${sec.class.name}-${sec.name}` : sec.name) : "" };
}

export async function getStudentLedger(student: StudentBrief, opts: { includeCancelled: boolean }): Promise<{ invoices: InvoiceView[]; payments: PaymentView[] }> {
  const db = await untyped();
  const [inv, pay] = await Promise.all([
    db.from("fee_invoice").select(INVOICE_COLS).eq("student_id", student.id)
      .order("due_date", { ascending: false }).order("id", { ascending: false }).limit(500),
    db.from("fee_payment").select(PAYMENT_COLS).eq("student_id", student.id)
      .order("paid_on", { ascending: false }).order("id", { ascending: false }).limit(500),
  ]);
  check(inv.error); check(pay.error);
  const invRows = ((inv.data ?? []) as InvoiceRow[]).filter((r) => opts.includeCancelled || r.status !== "cancelled");
  const [lines, payments] = await Promise.all([
    getLines(invRows.map((r) => r.id)),
    toPaymentViews((pay.data ?? []) as unknown as PaymentRow[], student),
  ]);
  const today = todayIST();
  return { invoices: invRows.map((r) => toInvoiceView(r, lines.get(r.id) ?? [], today)), payments };
}

// Find students by name or admission number (office). RLS-scoped.
export async function searchStudents(query: string, yearId: number): Promise<StudentBrief[]> {
  // Keep only what a name or admission number can hold; the rest could break the filter.
  const q = query.replace(/[^\p{L}\p{N} .'/-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (q.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("student").select("id, full_name, admission_no")
    .or(`full_name.ilike.%${q}%,admission_no.ilike.%${q}%`).order("full_name").limit(25);
  const students = data ?? [];
  if (!students.length) return [];
  const { data: enr } = await supabase.from("student_enrollment")
    .select("student_id, section:section_id(name, class:class_id(name))")
    .eq("academic_year_id", yearId).in("student_id", students.map((s) => s.id));
  const label = new Map<number, string>();
  for (const e of enr ?? []) {
    const sec = e.section as unknown as { name: string; class: { name: string } | null } | null;
    if (sec) label.set(e.student_id, sec.class ? `${sec.class.name}-${sec.name}` : sec.name);
  }
  return students.map((s) => ({ id: s.id, name: s.full_name, admissionNo: s.admission_no, classLabel: label.get(s.id) ?? "" }));
}

// ---------------------------------------------------------------------------
// Whole-school figures for a year (office / principal)
// ---------------------------------------------------------------------------
type SlimInvoice = { id: number; student_id: number; section_id: number | null; amount: number | string; paid_amount: number | string; due_date: string; status: InvoiceStatus };
const SLIM_COLS = "id, student_id, section_id, amount, paid_amount, due_date, status";

export async function getFeeOverview(yearId: number, sections: SectionOpt[]): Promise<FeeOverview> {
  const db = await untyped();
  const [invoices, payments] = await Promise.all([
    fetchAll<SlimInvoice>((c) =>
      db.from("fee_invoice").select(SLIM_COLS, countOpt(c)).eq("academic_year_id", yearId).neq("status", "cancelled").order("id")),
    fetchAll<{ amount: number | string; mode: FeeMode; is_refund: boolean }>((c) =>
      db.from("fee_payment").select("amount, mode, is_refund, fee_invoice!inner(academic_year_id)", countOpt(c))
        .eq("fee_invoice.academic_year_id", yearId).order("id")),
  ]);

  const today = todayIST();
  const secClass = new Map(sections.map((s) => [s.id, s]));
  const classes = new Map<number | null, { classId: number | null; name: string; level: number; billed: number; collected: number; pending: number }>();
  let billed = 0, pending = 0, overdueCount = 0, overdueAmount = 0;

  for (const r of invoices) {
    const amount = Number(r.amount), paid = Number(r.paid_amount);
    const bal = isOpen(r.status) ? Math.max(0, amount - paid) : 0;
    billed += amount; pending += bal;
    if (bal > 0 && r.due_date < today) { overdueCount++; overdueAmount += bal; }
    const sec = r.section_id ? secClass.get(r.section_id) : undefined;
    const key = sec?.class_id ?? null;
    const row = classes.get(key) ?? { classId: key, name: sec?.class_name ?? "Other", level: sec?.class_level ?? 999, billed: 0, collected: 0, pending: 0 };
    row.billed += amount; row.collected += paid; row.pending += bal;
    classes.set(key, row);
  }

  const modes = new Map<FeeMode, { amount: number; count: number }>();
  let collected = 0;
  for (const p of payments) {
    const signed = p.is_refund ? -Number(p.amount) : Number(p.amount);
    collected += signed;
    const m = modes.get(p.mode) ?? { amount: 0, count: 0 };
    m.amount += signed; m.count += 1;
    modes.set(p.mode, m);
  }

  return {
    collected: round2(collected), pending: round2(pending), billed: round2(billed),
    overdueCount, overdueAmount: round2(overdueAmount),
    byMode: FEE_MODES.filter((m) => modes.has(m)).map((m) => ({ mode: m, amount: round2(modes.get(m)!.amount), count: modes.get(m)!.count })),
    byClass: [...classes.values()].sort((a, b) => a.level - b.level)
      .map((c) => ({ classId: c.classId, name: c.name, billed: round2(c.billed), collected: round2(c.collected), pending: round2(c.pending) })),
  };
}

// Students with money outstanding this year. `sectionIds` narrows the list to
// a class or one section (the section the invoice was raised in).
export async function getDues(yearId: number, sectionIds: number[] | null): Promise<DueRow[]> {
  if (sectionIds && !sectionIds.length) return [];
  const db = await untyped();
  const supabase = await createClient();
  const invoices = await fetchAll<SlimInvoice>((c) => {
    let q = db.from("fee_invoice").select(SLIM_COLS, countOpt(c)).eq("academic_year_id", yearId).in("status", ["due", "part"]);
    if (sectionIds) q = q.in("section_id", sectionIds);
    return q.order("id");
  });
  if (!invoices.length) return [];

  const today = todayIST();
  const agg = new Map<number, { pending: number; oldest: string; invoices: number; sectionId: number | null }>();
  for (const r of invoices) {
    const bal = Math.max(0, Number(r.amount) - Number(r.paid_amount));
    if (bal <= 0) continue;
    const a = agg.get(r.student_id) ?? { pending: 0, oldest: r.due_date, invoices: 0, sectionId: r.section_id };
    a.pending += bal; a.invoices += 1;
    if (r.due_date < a.oldest) a.oldest = r.due_date;
    agg.set(r.student_id, a);
  }

  const ids = [...agg.keys()];
  const [students, names] = await Promise.all([
    inChunks<{ id: number; full_name: string; admission_no: string }>(ids, (chunk) =>
      supabase.from("student").select("id, full_name, admission_no").in("id", chunk)),
    getNames({ sectionIds: [...agg.values()].map((a) => a.sectionId) }),
  ]);
  const byId = new Map(students.map((s) => [s.id, s]));

  return ids.map((id) => {
    const a = agg.get(id)!;
    const s = byId.get(id);
    return {
      studentId: id, name: s?.full_name ?? "Student", admissionNo: s?.admission_no ?? "",
      classLabel: (a.sectionId ? names.section.get(a.sectionId) : undefined) ?? "",
      invoices: a.invoices, pending: round2(a.pending), oldestDue: a.oldest, overdue: a.oldest < today,
    };
  }).sort((x, y) => x.classLabel.localeCompare(y.classLabel, undefined, { numeric: true }) || x.name.localeCompare(y.name));
}
