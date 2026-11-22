import { untyped } from "@/lib/data/schedule";

// Homework and submissions (migration 0043). The generated database types do
// not know these tables yet, so queries go through the untyped client and every
// result is cast to the row types below.

export type HomeworkRow = {
  id: number;
  section_id: number;
  subject_id: number;
  academic_year_id: number;
  title: string;
  instructions: string;
  due_date: string; // yyyy-mm-dd
  link_url: string | null;
  max_marks: number | null;
  created_by: number;
  created_at: string;
};

export type SubmissionRow = {
  id: number;
  homework_id: number;
  student_id: number;
  note: string | null;
  link_url: string | null;
  submitted_at: string;
  is_late: boolean;
  marks: number | null;
  remark: string | null;
  checked_by: number | null;
  checked_at: string | null;
};

export type HomeworkCounts = { submitted: number; checked: number };

const HW_COLS = "id, section_id, subject_id, academic_year_id, title, instructions, due_date, link_url, max_marks, created_by, created_at";
const SUB_COLS = "id, homework_id, student_id, note, link_url, submitted_at, is_late, marks, remark, checked_by, checked_at";

type PgError = { code?: string; message?: string } | null;

// True when the error means migration 0043 has not been applied yet.
export function isHomeworkMissing(error: PgError): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01" || error.code === "PGRST202") return true;
  const m = (error.message ?? "").toLowerCase();
  return m.includes("homework") && (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"));
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const toHomework = (r: HomeworkRow): HomeworkRow => ({ ...r, max_marks: num(r.max_marks) });
const toSubmission = (r: SubmissionRow): SubmissionRow => ({ ...r, marks: num(r.marks) });

// Today's date in school time (India), yyyy-mm-dd. Late and overdue are judged
// against this, the same clock the database uses (app.school_today()).
export function schoolTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Homework the caller may read (row rules decide), newest first.
// `missing` = the tables are not there yet.
export async function listHomework(opts: {
  yearId: number;
  sectionIds?: number[];
  subjectId?: number | null;
  limit?: number;
}): Promise<{ missing: true } | { missing: false; rows: HomeworkRow[] }> {
  if (opts.sectionIds && !opts.sectionIds.length) return { missing: false, rows: [] };
  const db = await untyped();
  let q = db.from("homework").select(HW_COLS).eq("academic_year_id", opts.yearId);
  if (opts.sectionIds) q = q.in("section_id", opts.sectionIds);
  if (opts.subjectId) q = q.eq("subject_id", opts.subjectId);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) {
    if (isHomeworkMissing(error)) return { missing: true };
    throw new Error(error.message);
  }
  return { missing: false, rows: ((data ?? []) as HomeworkRow[]).map(toHomework) };
}

export async function getHomework(id: number): Promise<HomeworkRow | null> {
  const db = await untyped();
  const { data, error } = await db.from("homework").select(HW_COLS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toHomework(data as HomeworkRow);
}

// "N of M submitted": N per homework. Counted in the database, under the
// caller's own row rules.
export async function getSubmissionCounts(homeworkIds: number[]): Promise<Map<number, HomeworkCounts>> {
  const out = new Map<number, HomeworkCounts>();
  if (!homeworkIds.length) return out;
  const db = await untyped();
  const { data, error } = await db.rpc("homework_submission_counts", { p_ids: homeworkIds });
  if (error) return out;
  for (const r of (data ?? []) as { homework_id: number; submitted: number; checked: number }[]) {
    out.set(Number(r.homework_id), { submitted: Number(r.submitted), checked: Number(r.checked) });
  }
  return out;
}

// M: students on the roll of each section the caller can see.
export async function getSectionSizes(yearId: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const db = await untyped();
  const { data, error } = await db.rpc("homework_section_sizes", { p_year: yearId });
  if (error) return out;
  for (const r of (data ?? []) as { section_id: number; students: number }[]) out.set(Number(r.section_id), Number(r.students));
  return out;
}

// Every submission for one homework (teacher / principal view).
export async function getHomeworkSubmissions(homeworkId: number): Promise<SubmissionRow[]> {
  const db = await untyped();
  const { data, error } = await db.from("homework_submission").select(SUB_COLS).eq("homework_id", homeworkId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SubmissionRow[]).map(toSubmission);
}

// One student's submissions for a set of homework (student / guardian view).
export async function getStudentSubmissions(studentId: number, homeworkIds: number[]): Promise<Map<number, SubmissionRow>> {
  const out = new Map<number, SubmissionRow>();
  if (!homeworkIds.length) return out;
  const db = await untyped();
  const { data, error } = await db.from("homework_submission").select(SUB_COLS)
    .eq("student_id", studentId).in("homework_id", homeworkIds);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as SubmissionRow[]) out.set(r.homework_id, toSubmission(r));
  return out;
}
