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
