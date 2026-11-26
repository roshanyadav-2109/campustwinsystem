"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession, getCurrentYear } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";
import { fetchAll, inChunks } from "@/lib/data/fees";
import { FEE_MODES, fmtMoney, round2, statusOf, todayIST, type FeeMode } from "@/components/fees/shared";

// Every write on the Fees page. Only the office may change fee records; the
// principal reads. The database row rules enforce the same thing.

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const NOT_ALLOWED = "Only the school office can change fee records.";
const TRY_AGAIN = "That could not be saved. Please try again.";
const MAX_AMOUNT = 10_000_000;

async function office() {
  const session = await getSession();
  if (!session?.staffId || session.staffRole !== "office") return null;
  return session;
}

const isId = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const text = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
// A rupee amount with at most two decimals, or null when it is not one.
function money(n: unknown, allowZero = false): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const v = round2(n);
  if (v < 0 || v > MAX_AMOUNT || (!allowZero && v === 0)) return null;
  return v;
}

const done = () => revalidatePath("/dashboard/fees");

// ---------------------------------------------------------------------------
// Fee setup
// ---------------------------------------------------------------------------
export async function saveFeeHead(input: { id?: number; name: string; isActive: boolean }) {
  if (!(await office())) return fail(NOT_ALLOWED);
  const name = text(input.name, 60);
  if (!name) return fail("Enter a name for the fee head.");
  if (input.id !== undefined && !isId(input.id)) return fail(TRY_AGAIN);
  const db = await untyped();
  const row = { name, is_active: !!input.isActive };
  const { error } = input.id !== undefined
    ? await db.from("fee_head").update(row).eq("id", input.id)
    : await db.from("fee_head").insert(row);
  if (error) return fail(error.code === "23505" ? "A fee head with this name already exists." : TRY_AGAIN);
  done();
  return { ok: true as const };
}

// Amount per class per head for the current year.
export async function saveFeeStructure(entries: { classId: number; headId: number; amount: number }[]) {
  if (!(await office())) return fail(NOT_ALLOWED);
  const year = await getCurrentYear();
  if (!year) return fail("No academic year is set as current.");
  if (!Array.isArray(entries) || !entries.length) return { ok: true as const };
  if (entries.length > 1000) return fail("Too many amounts in one save.");
  const rows: { academic_year_id: number; class_id: number; fee_head_id: number; amount: number }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const amount = money(e?.amount, true);
    if (!isId(e?.classId) || !isId(e?.headId) || amount === null) return fail("Enter each amount as a number, zero or more.");
    const key = `${e.classId}:${e.headId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ academic_year_id: year.id, class_id: e.classId, fee_head_id: e.headId, amount });
  }
  const db = await untyped();
  const { error } = await db.from("fee_structure").upsert(rows, { onConflict: "academic_year_id,class_id,fee_head_id" });
  if (error) return fail(TRY_AGAIN);
  done();
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Raise fees: one invoice per enrolled student, built from the class's amounts
// ---------------------------------------------------------------------------
export async function raiseFees(input: { classId: number; sectionId?: number | null; title: string; dueDate: string }) {
  const session = await office();
  if (!session) return fail(NOT_ALLOWED);
  const year = await getCurrentYear();
  if (!year) return fail("No academic year is set as current.");
  const title = text(input.title, 80);
  if (!isId(input.classId)) return fail("Choose a class.");
  if (!title) return fail("Enter a title, for example Term 1 fees.");
  if (!isDate(input.dueDate)) return fail("Choose a due date.");
  const oneSection = input.sectionId ?? null;
  if (oneSection !== null && !isId(oneSection)) return fail("Choose a section.");

  const supabase = await createClient();
  const db = await untyped();

  const { data: secs } = await supabase.from("section").select("id").eq("class_id", input.classId);
  let sectionIds = (secs ?? []).map((s) => s.id);
  if (oneSection !== null) {
    if (!sectionIds.includes(oneSection)) return fail("That section is not in the chosen class.");
    sectionIds = [oneSection];
  }
  if (!sectionIds.length) return fail("This class has no sections.");

  // The class's fee heads and amounts for this year.
  const { data: struct, error: structErr } = await db.from("fee_structure")
    .select("fee_head_id, amount, fee_head(is_active)")
    .eq("academic_year_id", year.id).eq("class_id", input.classId);
  if (structErr) return fail(TRY_AGAIN);
  const lines = ((struct ?? []) as unknown as { fee_head_id: number; amount: number | string; fee_head: { is_active: boolean } | null }[])
    .filter((r) => r.fee_head?.is_active !== false && Number(r.amount) > 0)
    .map((r) => ({ fee_head_id: r.fee_head_id, amount: round2(Number(r.amount)) }));
  const total = round2(lines.reduce((n, l) => n + l.amount, 0));
  if (!lines.length || total <= 0) return fail("Set the fee amounts for this class in Fee setup first.");

  try {
    const enrolled = await fetchAll<{ student_id: number; section_id: number }>((c) =>
      supabase.from("student_enrollment").select("student_id, section_id", c ? { count: "exact" } : undefined)
        .eq("academic_year_id", year.id).in("section_id", sectionIds).neq("status", "transferred").order("id"));
    if (!enrolled.length) return fail("No students are enrolled there this year.");

    // Students who already have this bill this year are left alone.
    const existing = await inChunks<{ student_id: number; title: string }>(enrolled.map((e) => e.student_id), (chunk) =>
      db.from("fee_invoice").select("student_id, title").eq("academic_year_id", year.id)
        .neq("status", "cancelled").in("student_id", chunk).limit(5000));
    const want = title.toLowerCase();
    const has = new Set(existing.filter((r) => (r.title ?? "").trim().toLowerCase() === want).map((r) => r.student_id));

    const fresh = enrolled.filter((e) => !has.has(e.student_id));
    const skipped = enrolled.length - fresh.length;
    if (!fresh.length) return { ok: true as const, created: 0, skipped };

    const createdIds: number[] = [];
    const undo = async () => {
      for (let i = 0; i < createdIds.length; i += 200) await db.from("fee_invoice").delete().in("id", createdIds.slice(i, i + 200));
    };
    for (let i = 0; i < fresh.length; i += 500) {
      const batch = fresh.slice(i, i + 500).map((e) => ({
        student_id: e.student_id, section_id: e.section_id, academic_year_id: year.id,
        title, amount: total, due_date: input.dueDate, status: "due", created_by: session.staffId,
      }));
      const { data: made, error } = await db.from("fee_invoice").insert(batch).select("id");
      if (error || !made) { await undo(); return fail(TRY_AGAIN); }
      const ids = (made as { id: number }[]).map((m) => m.id);
      createdIds.push(...ids);
      const lineRows = ids.flatMap((id) => lines.map((l) => ({ invoice_id: id, fee_head_id: l.fee_head_id, amount: l.amount })));
      for (let j = 0; j < lineRows.length; j += 1000) {
        const { error: lineErr } = await db.from("fee_invoice_line").insert(lineRows.slice(j, j + 1000));
        if (lineErr) { await undo(); return fail(TRY_AGAIN); }
      }
    }
    done();
    return { ok: true as const, created: createdIds.length, skipped };
  } catch {
    return fail(TRY_AGAIN);
  }
}

// ---------------------------------------------------------------------------
// Collect: payments and refunds
// ---------------------------------------------------------------------------
type InvoiceCore = { id: number; amount: number | string; status: string };

// Payments minus refunds for an invoice, straight from the payment rows.
async function netPaid(invoiceId: number): Promise<number | null> {
  const db = await untyped();
  const { data, error } = await db.from("fee_payment").select("amount, is_refund").eq("invoice_id", invoiceId).limit(5000);
  if (error) return null;
  let paise = 0;
  for (const p of (data ?? []) as { amount: number | string; is_refund: boolean }[]) {
    const v = Math.round(Number(p.amount) * 100);
    paise += p.is_refund ? -v : v;
  }
  return paise / 100;
}

// Bring the invoice's paid total and status in line with its payments.
async function settle(inv: InvoiceCore): Promise<boolean> {
  const paid = await netPaid(inv.id);
  if (paid === null) return false;
  const db = await untyped();
  const { error } = await db.from("fee_invoice")
    .update({ paid_amount: paid, status: statusOf(Number(inv.amount), paid) })
    .eq("id", inv.id).neq("status", "cancelled");
  return !error;
}

export async function recordPayment(input: {
  invoiceId: number; amount: number; mode: string; reference?: string; paidOn: string; note?: string; isRefund?: boolean;
}) {
  const session = await office();
  if (!session) return fail(NOT_ALLOWED);
  if (!isId(input.invoiceId)) return fail("Choose an invoice.");
  const amount = money(input.amount);
  if (amount === null) return fail("Enter an amount greater than zero.");
  if (!FEE_MODES.includes(input.mode as FeeMode)) return fail("Choose how the money was paid.");
  if (!isDate(input.paidOn)) return fail("Choose the date.");
  if (input.paidOn > todayIST()) return fail("The date cannot be in the future.");
  const isRefund = input.isRefund === true;
  const reference = text(input.reference, 80) || null;
  const note = text(input.note, 300) || null;

  const db = await untyped();
  const { data: invData, error: invErr } = await db.from("fee_invoice").select("id, amount, status").eq("id", input.invoiceId).maybeSingle();
  const inv = invData as InvoiceCore | null;
  if (invErr || !inv) return fail("That invoice could not be found.");
  if (inv.status === "cancelled") return fail("This invoice is cancelled.");

  const paid = await netPaid(inv.id);
  if (paid === null) return fail(TRY_AGAIN);
  const balance = round2(Number(inv.amount) - paid);
  if (isRefund) {
    if (paid <= 0) return fail("Nothing has been paid on this invoice, so there is nothing to refund.");
    if (amount > paid) return fail(`A refund cannot be more than the amount paid, ${fmtMoney(paid)}.`);
  } else {
    if (balance <= 0) return fail("This invoice is already paid in full.");
    if (amount > balance) return fail(`This is more than the balance of ${fmtMoney(balance)}.`);
  }

  // The receipt number and the student are filled in by the database.
  const { data: made, error } = await db.from("fee_payment").insert({
    invoice_id: inv.id, amount, paid_on: input.paidOn, mode: input.mode,
    reference, note, is_refund: isRefund, received_by: session.staffId,
  }).select("receipt_no").single();
  if (error || !made) return fail(TRY_AGAIN);
  const receiptNo = (made as { receipt_no: string }).receipt_no;

  const settled = await settle(inv);
  done();
  if (!settled) return fail(`Receipt ${receiptNo} was saved, but the invoice total could not be updated. Open the student again to check.`);
  return { ok: true as const, receiptNo };
}

// An invoice raised by mistake can be cancelled while nothing is held against it.
export async function cancelInvoice(invoiceId: number) {
  if (!(await office())) return fail(NOT_ALLOWED);
  if (!isId(invoiceId)) return fail("Choose an invoice.");
  const paid = await netPaid(invoiceId);
  if (paid === null) return fail(TRY_AGAIN);
  if (paid > 0) return fail("Refund the amount paid before cancelling this invoice.");
  const db = await untyped();
  const { error } = await db.from("fee_invoice").update({ status: "cancelled", paid_amount: 0 }).eq("id", invoiceId);
  if (error) return fail(TRY_AGAIN);
  done();
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Instalments, concessions and head options
// ---------------------------------------------------------------------------
export async function saveFeeHeadOptions(input: { id: number; charge: string; isTuition: boolean }) {
  if (!(await office())) return fail(NOT_ALLOWED);
  if (!isId(input?.id) || (input.charge !== "split" && input.charge !== "once")) return fail(TRY_AGAIN);
  const db = await untyped();
  const { error } = await db.from("fee_head").update({ charge: input.charge, is_tuition: !!input.isTuition }).eq("id", input.id);
  if (error) return fail(TRY_AGAIN);
  done();
  return { ok: true as const };
}

// Saves the year's instalment plan. Instalments already raised stay exactly as
// they are; new ones must come after the last raised one, and all the shares
// together must make 100%.
export async function saveInstalments(rows: { id?: number; name: string; dueDate: string; sharePct: number }[]) {
  if (!(await office())) return fail(NOT_ALLOWED);
  const year = await getCurrentYear();
  if (!year) return fail("No academic year is set as current.");
  if (!Array.isArray(rows) || rows.length > 24) return fail("A year can have at most 24 instalments.");
  const db = await untyped();
  const { data: cur, error: curErr } = await db.from("fee_instalment").select("id, seq, name, due_date, share_pct").eq("academic_year_id", year.id).order("seq");
  if (curErr) return fail(TRY_AGAIN);
  const existing = (cur ?? []) as { id: number; seq: number; name: string; due_date: string; share_pct: number | string }[];
  const raisedIds = new Set<number>();
  for (const e of existing) {
    const { count } = await db.from("fee_invoice").select("id", { count: "exact", head: true }).eq("instalment_id", e.id).neq("status", "cancelled");
    if (count) raisedIds.add(e.id);
  }
  const raised = existing.filter((e) => raisedIds.has(e.id));
  const fresh: { name: string; due_date: string; share_pct: number }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r?.id && raisedIds.has(r.id)) continue;   // raised instalments cannot change
    const name = text(r?.name, 60);
    if (!name) return fail("Give every instalment a name, for example Term 1.");
    if (seen.has(name.toLowerCase())) return fail(`Two instalments are called ${name}.`);
    seen.add(name.toLowerCase());
    if (!isDate(r?.dueDate)) return fail(`Choose a due date for ${name}.`);
    const share = typeof r?.sharePct === "number" && Number.isFinite(r.sharePct) ? Math.round(r.sharePct * 1000) / 1000 : NaN;
    if (!(share > 0 && share <= 100)) return fail(`Enter the share of ${name} as a percentage.`);
    fresh.push({ name, due_date: r.dueDate, share_pct: share });
  }
  fresh.sort((a, b) => a.due_date.localeCompare(b.due_date));
  const lastRaised = raised[raised.length - 1];
  if (lastRaised && fresh.some((f) => f.due_date <= lastRaised.due_date)) {
    return fail(`${lastRaised.name} has already been raised, so new instalments must be due after ${lastRaised.due_date.split("-").reverse().join("/")}.`);
  }
  for (const r of raised) if (seen.has(r.name.toLowerCase())) return fail(`${r.name} already exists and has been raised.`);
  const total = Math.round((raised.reduce((n, r) => n + Number(r.share_pct), 0) + fresh.reduce((n, f) => n + f.share_pct, 0)) * 1000) / 1000;
  if (fresh.length + raised.length > 0 && Math.abs(total - 100) > 0.001) return fail(`The shares add up to ${total}%. They must add up to 100%.`);

  const drop = existing.filter((e) => !raisedIds.has(e.id)).map((e) => e.id);
  if (drop.length) {
    const { error } = await db.from("fee_instalment").delete().in("id", drop);
    if (error) return fail(TRY_AGAIN);
  }
  const start = (lastRaised?.seq ?? 0) + 1;
  if (fresh.length) {
    const { error } = await db.from("fee_instalment").insert(fresh.map((f, i) => ({ ...f, seq: start + i, academic_year_id: year.id })));
    if (error) return fail(TRY_AGAIN);
  }
  done();
  return { ok: true as const };
}

export async function raiseInstalment(input: { instalmentId: number; classId?: number | null; sectionId?: number | null }) {
  if (!(await office())) return fail(NOT_ALLOWED);
  if (!isId(input?.instalmentId)) return fail("Choose an instalment.");
  const classId = input.classId ?? null, sectionId = input.sectionId ?? null;
  if ((classId !== null && !isId(classId)) || (sectionId !== null && !isId(sectionId))) return fail(TRY_AGAIN);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("raise_instalment" as never, { p_instalment: input.instalmentId, p_class: classId, p_section: sectionId } as never);
  if (error) return fail(TRY_AGAIN);
  done();
  return { ok: true as const, created: Number(data ?? 0) };
}

export async function saveConcessionType(input: { id?: number; name: string; kind: string; value: number; headIds: number[] | null; sibling: boolean; active: boolean }) {
  if (!(await office())) return fail(NOT_ALLOWED);
  const name = text(input?.name, 60);
  if (!name) return fail("Enter a name, for example Sibling discount.");
  if (input.kind !== "percent" && input.kind !== "amount") return fail("Choose a percentage or an amount.");
  const value = money(input.value);
  if (value === null || (input.kind === "percent" && value > 100)) return fail(input.kind === "percent" ? "Enter a percentage between 0 and 100." : "Enter the amount off for the year.");
  const heads = Array.isArray(input.headIds) && input.headIds.length ? input.headIds.filter(isId) : null;
  if (input.id !== undefined && !isId(input.id)) return fail(TRY_AGAIN);
  const row = { name, kind: input.kind, value, head_ids: heads, auto_rule: input.sibling ? "sibling" : null, active: !!input.active };
  const db = await untyped();
  const { error } = input.id !== undefined
    ? await db.from("fee_concession_type").update(row).eq("id", input.id)
    : await db.from("fee_concession_type").insert(row);
  if (error) return fail(error.code === "23505" ? "A concession with this name already exists." : TRY_AGAIN);
  done();
  return { ok: true as const };
}

// Concessions apply to instalments raised from now on; invoices already raised
// are not changed.
export async function grantConcession(input: { studentId: number; typeId: number; note?: string }) {
  const session = await office();
  if (!session) return fail(NOT_ALLOWED);
  const year = await getCurrentYear();
  if (!year) return fail("No academic year is set as current.");
  if (!isId(input?.studentId) || !isId(input?.typeId)) return fail("Choose a concession.");
  const note = text(input.note, 300) || null;
  const db = await untyped();
  const { error } = await db.from("student_concession").upsert(
    { student_id: input.studentId, concession_type_id: input.typeId, academic_year_id: year.id, status: "active", is_auto: false, note, granted_by: session.staffId },
    { onConflict: "student_id,concession_type_id,academic_year_id" });
  if (error) return fail(TRY_AGAIN);
  done();
  return { ok: true as const };
}

export async function removeConcession(id: number) {
  if (!(await office())) return fail(NOT_ALLOWED);
  if (!isId(id)) return fail(TRY_AGAIN);
  const db = await untyped();
  const { error } = await db.from("student_concession").update({ status: "removed" }).eq("id", id);
  if (error) return fail(TRY_AGAIN);
  done();
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Late fees
// ---------------------------------------------------------------------------
type LateInput = { enabled: boolean; graceDays: number; kind: string; amount: number; maxAmount: number | null; includeOld: boolean };
type LateOk = { kind: string; grace: number; amount: number; max: number | null };
function lateRow(input: LateInput): LateOk | { error: string } {
  const kind = ["once", "per_week", "per_month"].includes(input?.kind) ? input.kind : null;
  const grace = Number.isInteger(input?.graceDays) && input.graceDays >= 0 && input.graceDays <= 90 ? input.graceDays : null;
  const amount = money(input?.amount);
  const max = input?.maxAmount == null ? null : money(input.maxAmount);
  if (!kind) return { error: "Choose how the late fee is charged." };
  if (grace === null) return { error: "Enter the days of grace, from 0 to 90." };
  if (amount === null) return { error: "Enter the late fee amount." };
  if (input.maxAmount != null && max === null) return { error: "Enter the most that can be charged, or leave it empty." };
  if (max !== null && max < amount) return { error: "The most that can be charged cannot be less than the late fee itself." };
  return { kind, grace, amount, max };
}

export async function previewLateRule(input: LateInput) {
  if (!(await office())) return fail(NOT_ALLOWED);
  const r = lateRow(input);
  if ("error" in r) return fail(r.error);
  const supabase = await createClient();
  const db = await untyped();
  const { data: cur } = await db.from("fee_late_rule").select("applies_from").maybeSingle();
  const from = input.includeOld ? null : ((cur as { applies_from: string | null } | null)?.applies_from ?? todayIST());
  const { data, error } = await supabase.rpc("late_fee_preview" as never, { p_grace: r.grace, p_kind: r.kind, p_amount: r.amount, p_max: r.max, p_from: from } as never);
  if (error) return fail(TRY_AGAIN);
  const row = ((data ?? []) as { invoices: number; extra: number | string }[])[0];
  return { ok: true as const, invoices: row?.invoices ?? 0, extra: Number(row?.extra ?? 0) };
}

export async function saveLateRule(input: LateInput) {
  const session = await office();
  if (!session) return fail(NOT_ALLOWED);
  const r = lateRow(input);
  if ("error" in r) return fail(r.error);
  const db = await untyped();
  const { data: cur } = await db.from("fee_late_rule").select("applies_from").maybeSingle();
  // By default only bills due from the day late fees were first switched on.
  const appliesFrom = input.includeOld ? null : ((cur as { applies_from: string | null } | null)?.applies_from ?? todayIST());
  const { error } = await db.from("fee_late_rule").upsert(
    { school_id: session.schoolId, enabled: !!input.enabled, grace_days: r.grace, kind: r.kind, amount: r.amount, max_amount: r.max, applies_from: appliesFrom, updated_at: new Date().toISOString() },
    { onConflict: "school_id" });
  if (error) return fail(TRY_AGAIN);
  let applied = 0;
  if (input.enabled) {
    const supabase = await createClient();
    const { data, error: applyErr } = await supabase.rpc("apply_late_fees" as never, { p_school: session.schoolId } as never);
    if (applyErr) return fail("The rule was saved, but late fees could not be added now. They will be added tonight.");
    applied = Number(data ?? 0);
  }
  done();
  return { ok: true as const, applied };
}

export async function waiveLateFee(input: { invoiceId: number; reason: string }) {
  if (!(await office())) return fail(NOT_ALLOWED);
  if (!isId(input?.invoiceId)) return fail(TRY_AGAIN);
  const reason = text(input.reason, 300);
  if (!reason) return fail("Enter the reason for waiving the late fee.");
  const db = await untyped();
  const { error } = await db.from("fee_invoice_line").update({ waived: true, waive_reason: reason })
    .eq("invoice_id", input.invoiceId).eq("kind", "late_fee").eq("waived", false);
  if (error) return fail(TRY_AGAIN);
  done();
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Tuition fee certificate (financial year April to March)
// ---------------------------------------------------------------------------
export async function getTuitionCertificate(input: { studentId: number; fyStartYear: number }) {
  const session = await getSession();
  if (!session) return fail(NOT_ALLOWED);
  if (!isId(input?.studentId) || !Number.isInteger(input?.fyStartYear) || input.fyStartYear < 2000 || input.fyStartYear > 2100) return fail(TRY_AGAIN);
  const supabase = await createClient();
  let allowed = session.isAdminScope || (session.role === "student" && session.studentId === input.studentId);
  if (!allowed && session.role === "guardian") {
    // A parent sees only their own children's links.
    const { data: mine } = await supabase.from("guardian_student").select("student_id").eq("student_id", input.studentId).limit(1);
    allowed = !!mine?.length;
  }
  if (!allowed) return fail(NOT_ALLOWED);
  const [{ data: st }, { data: tp }, { data: gs }] = await Promise.all([
    supabase.from("student").select("full_name, admission_no").eq("id", input.studentId).single(),
    supabase.rpc("tuition_paid" as never, { p_student: input.studentId, p_fy_start: `${input.fyStartYear}-04-01` } as never),
    supabase.from("guardian_student").select("guardian(full_name)").eq("student_id", input.studentId),
  ]);
  if (!st) return fail("That student could not be found.");
  const t = ((tp ?? []) as { paid: number | string; tuition: number | string }[])[0];
  const parents = ((gs ?? []) as unknown as { guardian: { full_name: string } | null }[])
    .map((g) => g.guardian?.full_name).filter((n): n is string => !!n);
  return {
    ok: true as const,
    name: st.full_name, admissionNo: st.admission_no, parents,
    fy: `${input.fyStartYear}-${String((input.fyStartYear + 1) % 100).padStart(2, "0")}`,
    paid: Number(t?.paid ?? 0), tuition: Number(t?.tuition ?? 0),
  };
}
