import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentYear } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";
import {
  DEFAULT_SETTINGS, daysLate, todayIST,
  type BookStock, type LibrarySettings, type Loan, type MemberRef,
} from "@/components/library/shared";

// Library data (migration 0045). The generated database types do not know
// these tables yet, so queries go through the untyped client and every result
// is cast to the row types in components/library/shared.
//
// Row Level Security decides what each caller gets back: the office and the
// principal see every issue, a student or guardian sees the student's own, a
// staff member sees their own. Nothing here widens that.

type PgError = { code?: string; message?: string } | null;

function isMissing(error: PgError): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01" || error.code === "PGRST202") return true;
  const m = (error.message ?? "").toLowerCase();
  return m.includes("library_") && (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"));
}

// Make free text safe to place inside a PostgREST `or(...)` filter.
export function likeTerm(q: string): string {
  return q.replace(/[,()"'\\%_*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// The single settings row. Null means the library tables are not there yet.
export async function getSettings(): Promise<LibrarySettings | null> {
  const db = await untyped();
  const { data, error } = await db
    .from("library_setting")
    .select("loan_days_student, loan_days_staff, max_books_student, max_books_staff, fine_per_day")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(error.message);
  }
  if (!data) return { ...DEFAULT_SETTINGS };
  const r = data as Record<string, unknown>;
  return {
    loan_days_student: num(r.loan_days_student, DEFAULT_SETTINGS.loan_days_student),
    loan_days_staff: num(r.loan_days_staff, DEFAULT_SETTINGS.loan_days_staff),
    max_books_student: num(r.max_books_student, DEFAULT_SETTINGS.max_books_student),
    max_books_staff: num(r.max_books_staff, DEFAULT_SETTINGS.max_books_staff),
    fine_per_day: num(r.fine_per_day, DEFAULT_SETTINGS.fine_per_day),
  };
}

// ---------------------------------------------------------------------------
// Catalogue (with availability, from the library_book_stock view)
// ---------------------------------------------------------------------------
export const STOCK_COLS =
  "id, accession_no, title, author, publisher, isbn, category, language, shelf, copies_total, is_active, copies_out, copies_available";

export const CATALOGUE_PAGE_SIZE = 50;

export type BookList = { rows: BookStock[]; total: number; page: number; pageSize: number };

export async function listBooks(opts: { q?: string; category?: string | null; page?: number; includeInactive?: boolean }): Promise<BookList> {
  const db = await untyped();
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const from = page * CATALOGUE_PAGE_SIZE;
  let query = db.from("library_book_stock").select(STOCK_COLS, { count: "exact" });
  if (!opts.includeInactive) query = query.eq("is_active", true);
  if (opts.category) query = query.eq("category", opts.category);
  const term = likeTerm(opts.q ?? "");
  if (term) {
    const v = `"%${term}%"`;
    query = query.or(`title.ilike.${v},author.ilike.${v},accession_no.ilike.${v},isbn.ilike.${v}`);
  }
  const { data, error, count } = await query.order("title").order("id").range(from, from + CATALOGUE_PAGE_SIZE - 1);
  if (error) {
    // Asking for a page past the end is not a failure, just an empty page.
    if (error.code === "PGRST103") return { rows: [], total: 0, page, pageSize: CATALOGUE_PAGE_SIZE };
    throw new Error(error.message);
  }
  return { rows: (data ?? []) as unknown as BookStock[], total: count ?? 0, page, pageSize: CATALOGUE_PAGE_SIZE };
}

export async function getCategories(): Promise<string[]> {
  const db = await untyped();
  const { data, error } = await db.rpc("library_categories");
  if (error) return [];
  return ((data ?? []) as unknown[]).map((c) => String(c)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------
const LOAN_COLS =
  "id, book_id, student_id, staff_id, issued_on, due_on, returned_on, fine_amount, fine_paid, note, " +
  "book:book_id(accession_no, title, author), student:student_id(full_name, admission_no), staff:staff_id(full_name)";

type RawLoan = {
  id: number;
  book_id: number;
  student_id: number | null;
  staff_id: number | null;
  issued_on: string;
  due_on: string;
  returned_on: string | null;
  fine_amount: number | string;
  fine_paid: boolean;
  note: string | null;
  book: { accession_no: string; title: string; author: string } | null;
  student: { full_name: string; admission_no: string } | null;
  staff: { full_name: string } | null;
};

function loanSelect(db: SupabaseClient) {
  return db.from("library_issue").select(LOAN_COLS);
}
type LoanQuery = ReturnType<typeof loanSelect>;

// Read every matching row, a thousand at a time (the API caps one reply).
async function loadLoans(apply: (q: LoanQuery) => LoanQuery, cap = 5000): Promise<RawLoan[]> {
  const db = await untyped();
  const out: RawLoan[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await apply(loanSelect(db)).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RawLoan[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// "VIII-A" for each student enrolled this year.
export async function sectionLabels(studentIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const ids = [...new Set(studentIds)];
  if (!ids.length) return out;
  const year = await getCurrentYear();
  if (!year) return out;
  const supabase = await createClient();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("student_enrollment")
      .select("student_id, section:section_id(name, class:class_id(name))")
      .eq("academic_year_id", year.id)
      .in("student_id", ids.slice(i, i + 200));
    for (const e of data ?? []) {
      const sec = e.section as unknown as { name: string; class: { name: string } | null } | null;
      if (sec) out.set(e.student_id, sec.class ? `${sec.class.name}-${sec.name}` : sec.name);
    }
  }
  return out;
}

async function toLoans(raw: RawLoan[], finePerDay: number, withSections: boolean): Promise<Loan[]> {
  const today = todayIST();
  const labels = withSections
    ? await sectionLabels(raw.map((r) => r.student_id).filter((x): x is number => x != null))
    : new Map<number, string>();
  return raw.map((r) => {
    const open = !r.returned_on;
    const late = daysLate(r.due_on, r.returned_on ?? today);
    const isStudent = r.student_id != null;
    return {
      id: r.id,
      book_id: r.book_id,
      accession_no: r.book?.accession_no ?? "",
      title: r.book?.title ?? "Book",
      author: r.book?.author ?? "",
      member_kind: isStudent ? "student" : "staff",
      member_id: (isStudent ? r.student_id : r.staff_id) ?? 0,
      member_name: (isStudent ? r.student?.full_name : r.staff?.full_name) ?? "—",
      admission_no: r.student?.admission_no ?? null,
      class_section: isStudent ? labels.get(r.student_id as number) ?? null : null,
      issued_on: r.issued_on,
      due_on: r.due_on,
      returned_on: r.returned_on,
      days_late: late,
      fine: open ? Math.round(late * finePerDay * 100) / 100 : num(r.fine_amount),
      fine_paid: r.fine_paid,
      note: r.note,
    };
  });
}

// Every book that is out right now, earliest due date first.
export async function getOpenLoans(finePerDay: number): Promise<Loan[]> {
  const raw = await loadLoans((q) => q.is("returned_on", null).order("due_on"));
  return toLoans(raw, finePerDay, true);
}

// Returned books whose fine has not been collected yet.
export async function getUnpaidFines(finePerDay: number): Promise<Loan[]> {
  const raw = await loadLoans((q) => q.not("returned_on", "is", null).gt("fine_amount", 0).eq("fine_paid", false).order("returned_on", { ascending: false }));
  return toLoans(raw, finePerDay, true);
}

// One member's books: what they hold now and what they have returned.
// Works for a student, a staff member, or (later) a guardian's child.
export async function getMemberLoans(member: MemberRef, finePerDay: number): Promise<{ current: Loan[]; history: Loan[] }> {
  const col = member.kind === "student" ? "student_id" : "staff_id";
  const db = await untyped();
  const [current, past] = await Promise.all([
    loadLoans((q) => q.eq(col, member.id).is("returned_on", null).order("due_on"), 1000),
    db.from("library_issue").select(LOAN_COLS).eq(col, member.id).not("returned_on", "is", null)
      .order("returned_on", { ascending: false }).order("id", { ascending: false }).limit(100),
  ]);
  if (past.error) throw new Error(past.error.message);
  const [cur, hist] = await Promise.all([
    toLoans(current, finePerDay, false),
    toLoans((past.data ?? []) as unknown as RawLoan[], finePerDay, false),
  ]);
  return { current: cur, history: hist };
}

export type LibraryOverview = {
  titles: number;
  copies: number;
  outNow: number;
  overdueNow: number;
  finesRecorded: number;   // returned, fine not yet collected
  finesBuilding: number;   // on overdue books still out
};

export async function getOverview(finePerDay: number): Promise<LibraryOverview> {
  const db = await untyped();
  const [totals, open, unpaid] = await Promise.all([
    db.rpc("library_totals"),
    getOpenLoans(finePerDay),
    getUnpaidFines(finePerDay),
  ]);
  const t = ((totals.data ?? []) as { titles: number | string; copies: number | string }[])[0];
  const overdue = open.filter((l) => l.days_late > 0);
  return {
    titles: num(t?.titles),
    copies: num(t?.copies),
    outNow: open.length,
    overdueNow: overdue.length,
    finesRecorded: unpaid.reduce((s, l) => s + l.fine, 0),
    finesBuilding: overdue.reduce((s, l) => s + l.fine, 0),
  };
}
