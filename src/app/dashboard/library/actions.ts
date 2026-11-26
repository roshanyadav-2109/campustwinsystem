"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";
import { STOCK_COLS, getMemberLoans, getSettings, likeTerm, sectionLabels } from "@/lib/data/library";
import {
  addDays, cleanBook, daysLate, todayIST,
  type ActionResult, type BookInput, type BookStock, type Member, type MemberKind, type MemberStatus,
} from "@/components/library/shared";

// The office is the librarian. Every action checks that again here; Row Level
// Security checks it a third time in the database.

const PATH = "/dashboard/library";
const NOT_ALLOWED = "Only the office can do this.";

async function officeSession() {
  const session = await getSession();
  return session?.staffRole === "office" && session.staffId ? session : null;
}

const validId = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
const validKind = (k: unknown): k is MemberKind => k === "student" || k === "staff";

const STAFF_ROLE_LABEL: Record<string, string> = {
  principal: "Principal", office: "Office", class_teacher: "Teacher", subject_teacher: "Teacher", transport: "Transport staff",
};

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
function bookRow(b: BookInput) {
  return {
    accession_no: b.accessionNo,
    title: b.title,
    author: b.author,
    publisher: b.publisher || null,
    isbn: b.isbn || null,
    category: b.category,
    language: b.language || null,
    shelf: b.shelf || null,
    copies_total: b.copies,
  };
}

export async function saveBook(input: { id?: number | null } & Partial<Record<keyof BookInput, unknown>>): Promise<ActionResult> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  const { book, errors } = cleanBook(input ?? {});
  if (errors.length) return { ok: false, error: `${errors[0]}.` };

  const db = await untyped();
  if (input.id != null) {
    if (!validId(input.id)) return { ok: false, error: "That book could not be found." };
    const { count, error: countError } = await db.from("library_issue")
      .select("id", { count: "exact", head: true }).eq("book_id", input.id).is("returned_on", null);
    if (countError) return { ok: false, error: "The book could not be saved. Please try again." };
    if ((count ?? 0) > book.copies) {
      return { ok: false, error: `${count} copies of this book are out right now, so the total cannot be less than ${count}.` };
    }
    const { data, error } = await db.from("library_book").update(bookRow(book)).eq("id", input.id).select("id");
    if (error) return { ok: false, error: error.code === "23505" ? "Another book already has this accession number." : "The book could not be saved. Please try again." };
    if (!data?.length) return { ok: false, error: "That book could not be found." };
  } else {
    const { error } = await db.from("library_book").insert({ ...bookRow(book), added_by: session.staffId });
    if (error) return { ok: false, error: error.code === "23505" ? "A book with this accession number is already in the catalogue." : "The book could not be added. Please try again." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function setBookActive(bookId: number, active: boolean): Promise<ActionResult> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  if (!validId(bookId)) return { ok: false, error: "That book could not be found." };
  const db = await untyped();
  const { error } = await db.from("library_book").update({ is_active: active === true }).eq("id", bookId);
  if (error) return { ok: false, error: "The book could not be updated. Please try again." };
  revalidatePath(PATH);
  return { ok: true };
}

// Bulk add. Accession numbers already in the catalogue are left untouched.
export async function importBooks(rows: Partial<Record<keyof BookInput, unknown>>[]): Promise<ActionResult<{ added: number; skipped: number }>> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "There are no rows to add." };
  if (rows.length > 1000) return { ok: false, error: "Please add at most 1000 books at a time." };

  const seen = new Set<string>();
  const clean: BookInput[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { book, errors } = cleanBook(rows[i] ?? {});
    if (errors.length) return { ok: false, error: `Row ${i + 1}: ${errors[0]}.` };
    if (seen.has(book.accessionNo)) return { ok: false, error: `Row ${i + 1}: accession number ${book.accessionNo} appears twice.` };
    seen.add(book.accessionNo);
    clean.push(book);
  }

  const db = await untyped();
  const { data, error } = await db.from("library_book")
    .upsert(clean.map((b) => ({ ...bookRow(b), added_by: session.staffId })), { onConflict: "school_id,accession_no", ignoreDuplicates: true })
    .select("id");
  if (error) return { ok: false, error: "The books could not be added. Please check the rows and try again." };
  const added = data?.length ?? 0;
  revalidatePath(PATH);
  return { ok: true, added, skipped: clean.length - added };
}

// ---------------------------------------------------------------------------
// Issue desk look-ups
// ---------------------------------------------------------------------------
export async function searchMembers(q: string): Promise<ActionResult<{ members: Member[] }>> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  const term = likeTerm(String(q ?? ""));
  if (term.length < 2) return { ok: false, error: "Type at least two letters or digits." };

  const supabase = await createClient();
  const v = `"%${term}%"`;
  const [students, staff] = await Promise.all([
    supabase.from("student").select("id, full_name, admission_no")
      .or(`full_name.ilike.${v},admission_no.ilike.${v}`).order("full_name").limit(10),
    supabase.from("staff").select("id, full_name, role").ilike("full_name", `%${term}%`).order("full_name").limit(6),
  ]);
  if (students.error || staff.error) return { ok: false, error: "The search did not work. Please try again." };

  const labels = await sectionLabels((students.data ?? []).map((s) => s.id));
  const members: Member[] = [
    ...(students.data ?? []).map((s) => ({
      kind: "student" as const, id: s.id, name: s.full_name,
      detail: [`Adm. no ${s.admission_no}`, labels.get(s.id)].filter(Boolean).join(" · "),
    })),
    ...(staff.data ?? []).map((s) => ({
      kind: "staff" as const, id: s.id, name: s.full_name, detail: STAFF_ROLE_LABEL[s.role as string] ?? "Staff",
    })),
  ];
  return { ok: true, members };
}

async function memberStatus(kind: MemberKind, id: number): Promise<MemberStatus | null> {
  const settings = await getSettings();
  if (!settings) return null;
  const { current } = await getMemberLoans({ kind, id }, settings.fine_per_day);
  return {
    loans: current,
    limit: kind === "student" ? settings.max_books_student : settings.max_books_staff,
    loanDays: kind === "student" ? settings.loan_days_student : settings.loan_days_staff,
    hasOverdue: current.some((l) => l.days_late > 0),
  };
}

export async function getMemberStatus(kind: MemberKind, id: number): Promise<ActionResult<{ status: MemberStatus }>> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  if (!validKind(kind) || !validId(id)) return { ok: false, error: "That member could not be found." };
  const status = await memberStatus(kind, id);
  if (!status) return { ok: false, error: "The library is not set up yet." };
  return { ok: true, status };
}

export async function searchBooksForIssue(q: string): Promise<ActionResult<{ books: BookStock[] }>> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  const term = likeTerm(String(q ?? ""));
  if (term.length < 2) return { ok: false, error: "Type at least two letters or digits." };
  const db = await untyped();
  const v = `"%${term}%"`;
  const { data, error } = await db.from("library_book_stock").select(STOCK_COLS)
    .eq("is_active", true)
    .or(`title.ilike.${v},accession_no.ilike.${v},author.ilike.${v},isbn.ilike.${v}`)
    .order("title").limit(10);
  if (error) return { ok: false, error: "The search did not work. Please try again." };
  return { ok: true, books: (data ?? []) as unknown as BookStock[] };
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------
export async function issueBook(input: { kind: MemberKind; memberId: number; bookId: number; note?: string }): Promise<ActionResult<{ dueOn: string }>> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  if (!input || !validKind(input.kind) || !validId(input.memberId)) return { ok: false, error: "Choose a member first." };
  if (!validId(input.bookId)) return { ok: false, error: "Choose a book first." };
  const note = String(input.note ?? "").trim().slice(0, 300);

  const db = await untyped();
  const supabase = await createClient();

  // The member must exist.
  const found = input.kind === "student"
    ? await supabase.from("student").select("id").eq("id", input.memberId).maybeSingle()
    : await supabase.from("staff").select("id").eq("id", input.memberId).maybeSingle();
  if (!found.data) return { ok: false, error: "That member could not be found." };

  const status = await memberStatus(input.kind, input.memberId);
  if (!status) return { ok: false, error: "The library is not set up yet." };
  if (status.hasOverdue) return { ok: false, error: "This member has an overdue book. It must be returned before another is issued." };
  if (status.loans.length >= status.limit) {
    return { ok: false, error: `This member already holds ${status.loans.length} of ${status.limit} books allowed.` };
  }
  if (status.loans.some((l) => l.book_id === input.bookId)) return { ok: false, error: "This member already holds a copy of this book." };

  // The book must be in use and have a copy on the shelf.
  const { data: bookData, error: bookError } = await db.from("library_book_stock")
    .select("id, is_active, copies_total, copies_available").eq("id", input.bookId).maybeSingle();
  if (bookError) return { ok: false, error: "The book could not be checked. Please try again." };
  const book = bookData as { id: number; is_active: boolean; copies_total: number; copies_available: number } | null;
  if (!book) return { ok: false, error: "That book could not be found." };
  if (!book.is_active) return { ok: false, error: "This book has been taken out of the catalogue." };
  if (Number(book.copies_available) <= 0) return { ok: false, error: "All copies of this book are out." };

  const issuedOn = todayIST();
  const dueOn = addDays(issuedOn, status.loanDays);
  const { error } = await db.from("library_issue").insert({
    book_id: input.bookId,
    student_id: input.kind === "student" ? input.memberId : null,
    staff_id: input.kind === "staff" ? input.memberId : null,
    issued_on: issuedOn,
    due_on: dueOn,
    issued_by: session.staffId,
    note: note || null,
  });
  if (error) return { ok: false, error: "The book could not be issued. Please try again." };
  revalidatePath(PATH);
  return { ok: true, dueOn };
}

// ---------------------------------------------------------------------------
// Return and fines
// ---------------------------------------------------------------------------
export async function returnBook(issueId: number, finePaidNow = false): Promise<ActionResult<{ fine: number; daysLate: number; finePaid: boolean }>> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  if (!validId(issueId)) return { ok: false, error: "That entry could not be found." };
  const settings = await getSettings();
  if (!settings) return { ok: false, error: "The library is not set up yet." };

  const db = await untyped();
  const { data: issueData, error: readError } = await db.from("library_issue")
    .select("id, issued_on, due_on, returned_on").eq("id", issueId).maybeSingle();
  if (readError) return { ok: false, error: "The return could not be saved. Please try again." };
  const issue = issueData as { id: number; issued_on: string; due_on: string; returned_on: string | null } | null;
  if (!issue) return { ok: false, error: "That entry could not be found." };
  if (issue.returned_on) return { ok: false, error: "This book has already been returned." };

  const today = todayIST();
  // A return is never dated before the issue (guards against clock oddities).
  const returnedOn = today < issue.issued_on ? issue.issued_on : today;
  const late = daysLate(issue.due_on, returnedOn);
  const fine = Math.round(late * settings.fine_per_day * 100) / 100;
  const finePaid = fine > 0 && finePaidNow === true;

  const { data, error } = await db.from("library_issue")
    .update({ returned_on: returnedOn, fine_amount: fine, fine_paid: finePaid, returned_to: session.staffId })
    .eq("id", issueId).is("returned_on", null).select("id");
  if (error) return { ok: false, error: "The return could not be saved. Please try again." };
  if (!data?.length) return { ok: false, error: "This book has already been returned." };
  revalidatePath(PATH);
  return { ok: true, fine, daysLate: late, finePaid };
}

export async function markFinePaid(issueId: number): Promise<ActionResult> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  if (!validId(issueId)) return { ok: false, error: "That entry could not be found." };
  const db = await untyped();
  const { data, error } = await db.from("library_issue")
    .update({ fine_paid: true }).eq("id", issueId).not("returned_on", "is", null).gt("fine_amount", 0).select("id");
  if (error) return { ok: false, error: "The fine could not be updated. Please try again." };
  if (!data?.length) return { ok: false, error: "There is no fine to collect on this entry." };
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function saveSettings(input: {
  loanDaysStudent: number; loanDaysStaff: number; maxBooksStudent: number; maxBooksStaff: number; finePerDay: number;
}): Promise<ActionResult> {
  const session = await officeSession();
  if (!session) return { ok: false, error: NOT_ALLOWED };
  const whole = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const loanStudent = whole(input?.loanDaysStudent, 1, 365);
  const loanStaff = whole(input?.loanDaysStaff, 1, 365);
  const maxStudent = whole(input?.maxBooksStudent, 0, 50);
  const maxStaff = whole(input?.maxBooksStaff, 0, 50);
  const fineRaw = Number(input?.finePerDay);
  if (loanStudent == null || loanStaff == null) return { ok: false, error: "Loan days must be a whole number from 1 to 365." };
  if (maxStudent == null || maxStaff == null) return { ok: false, error: "Books allowed must be a whole number from 0 to 50." };
  if (!Number.isFinite(fineRaw) || fineRaw < 0 || fineRaw > 1000) return { ok: false, error: "Fine per day must be between 0 and 1000." };

  const db = await untyped();
  const { error } = await db.from("library_setting").upsert({
    id: 1,
    loan_days_student: loanStudent,
    loan_days_staff: loanStaff,
    max_books_student: maxStudent,
    max_books_staff: maxStaff,
    fine_per_day: Math.round(fineRaw * 100) / 100,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) return { ok: false, error: "The settings could not be saved. Please try again." };
  revalidatePath(PATH);
  return { ok: true };
}
