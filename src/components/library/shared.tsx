// Types and small pure helpers shared by the library's server code and its
// client components. Nothing here touches the database.

export type Book = {
  id: number;
  accession_no: string;
  title: string;
  author: string;
  publisher: string | null;
  isbn: string | null;
  category: string;
  language: string | null;
  shelf: string | null;
  copies_total: number;
  is_active: boolean;
};

export type BookStock = Book & { copies_out: number; copies_available: number };

export type LibrarySettings = {
  loan_days_student: number;
  loan_days_staff: number;
  max_books_student: number;
  max_books_staff: number;
  fine_per_day: number;
};

export const DEFAULT_SETTINGS: LibrarySettings = {
  loan_days_student: 14, loan_days_staff: 30, max_books_student: 2, max_books_staff: 5, fine_per_day: 2,
};

export type MemberKind = "student" | "staff";

// Who a book is lent to. A guardian view can pass its child's studentId.
export type MemberRef = { kind: MemberKind; id: number };

export type Member = MemberRef & { name: string; detail: string };

export type Loan = {
  id: number;
  book_id: number;
  accession_no: string;
  title: string;
  author: string;
  member_kind: MemberKind;
  member_id: number;
  member_name: string;
  admission_no: string | null;
  class_section: string | null;
  issued_on: string;
  due_on: string;
  returned_on: string | null;
  days_late: number;      // as of today for a book still out, else on the return date
  fine: number;           // fine so far for a book still out, else the recorded fine
  fine_paid: boolean;
  note: string | null;
};

export type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export type MemberStatus = {
  loans: Loan[];
  limit: number;
  loanDays: number;
  hasOverdue: boolean;
};

export const CATEGORY_SUGGESTIONS = [
  "Fiction", "Non-fiction", "Science", "Mathematics", "Social Science", "Languages",
  "Reference", "Biography", "Comics", "General Knowledge", "Textbook",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-02-26" -> "26 Feb 2026"
export function fmtDay(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return d;
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

// 12500 -> "₹ 12,500"
export function fmtMoney(n: number): string {
  return `₹ ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)}`;
}

// Today's date at the school (India), as YYYY-MM-DD.
export function todayIST(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// Whole days between the due date and `on`; never negative.
export function daysLate(due: string, on: string): number {
  const diff = Date.parse(`${on.slice(0, 10)}T00:00:00Z`) - Date.parse(`${due.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff / 86400000)) : 0;
}

export function availabilityText(b: { copies_total: number; copies_available: number }): string {
  if (b.copies_total <= 0) return "No copies";
  if (b.copies_available <= 0) return "All copies out";
  return `${b.copies_available} of ${b.copies_total} available`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Book input: one set of rules for the add/edit form, the bulk upload preview
// and the server actions.
// ---------------------------------------------------------------------------
export type BookInput = {
  accessionNo: string;
  title: string;
  author: string;
  publisher: string;
  isbn: string;
  category: string;
  language: string;
  shelf: string;
  copies: number;
};

const tidy = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function cleanBook(raw: Partial<Record<keyof BookInput, unknown>>): { book: BookInput; errors: string[] } {
  const copiesRaw = String(raw.copies ?? "").trim();
  const copies = copiesRaw === "" ? 1 : Number(copiesRaw);
  const book: BookInput = {
    accessionNo: tidy(raw.accessionNo, 30).toUpperCase(),
    title: tidy(raw.title, 200),
    author: tidy(raw.author, 150),
    publisher: tidy(raw.publisher, 150),
    isbn: tidy(raw.isbn, 20),
    category: tidy(raw.category, 60),
    language: tidy(raw.language, 40),
    shelf: tidy(raw.shelf, 40),
    copies,
  };
  const errors: string[] = [];
  if (!book.accessionNo) errors.push("Accession number is missing");
  if (!book.title) errors.push("Title is missing");
  if (!book.author) errors.push("Author is missing");
  if (!book.category) errors.push("Category is missing");
  if (!Number.isInteger(copies) || copies < 0 || copies > 9999) errors.push("Copies must be a whole number from 0 to 9999");
  return { book, errors };
}

export const BULK_HEADERS = ["Accession no", "Title", "Author", "Publisher", "ISBN", "Category", "Language", "Shelf", "Copies"];

// ---------------------------------------------------------------------------
// Shared look
// ---------------------------------------------------------------------------
export const tabCls = (on: boolean) =>
  `inline-flex h-9 items-center rounded-sm border px-3 text-[13px] font-medium transition-colors ${
    on
      ? "border-[#0F6CBD] bg-[#EBF3FC] text-[#0F6CBD] font-semibold"
      : "border-hair bg-surface text-ink-700 hover:border-[#B4D6FA] hover:bg-[#F5F9FE]"
  }`;

export const thCls = "px-4 py-2 text-left text-[12px] font-semibold text-ink-700 whitespace-nowrap";
export const tdCls = "px-4 py-2 align-top text-[13px] text-ink-900";
