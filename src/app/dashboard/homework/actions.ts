"use server";
import { revalidatePath } from "next/cache";
import { getSession, getCurrentYear } from "@/lib/session";
import { getStaffScope } from "@/lib/data/scope";
import { getMyChildren } from "@/lib/data/analytics";
import { untyped } from "@/lib/data/schedule";
import { schoolTodayISO } from "@/lib/data/homework";

type Result = { ok: true } | { ok: false; error: string };

const TITLE_MAX = 120;
const INSTRUCTIONS_MAX = 2000;
const NOTE_MAX = 1000;
const REMARK_MAX = 500;
const LINK_MAX = 500;
const MARKS_CEILING = 1000;
const GENERIC = "Could not save. Please try again.";

const fail = (error: string): Result => ({ ok: false, error });
const posInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// A link is optional; when given it must be a real https address.
function cleanLink(v: unknown): { ok: true; value: string | null } | { ok: false } {
  const s = text(v);
  if (!s) return { ok: true, value: null };
  if (s.length > LINK_MAX || /\s/.test(s) || !s.startsWith("https://")) return { ok: false };
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !u.hostname) return { ok: false };
  } catch {
    return { ok: false };
  }
  return { ok: true, value: s };
}

function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Maximum marks are optional; up to two decimals.
function cleanMaxMarks(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MARKS_CEILING) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

// Messages raised by our own database functions are written in plain words
// (code P0001) and can be shown as they are; anything else stays generic.
function dbMessage(error: { code?: string; message?: string } | null): string {
  if (error?.code === "P0001" && error.message) return error.message;
  return GENERIC;
}

type HomeworkFields = {
  title: string;
  instructions: string;
  dueDate: string;
  linkUrl?: string | null;
  maxMarks?: number | string | null;
};

function cleanFields(input: HomeworkFields):
  | { ok: true; value: { title: string; instructions: string; due_date: string; link_url: string | null; max_marks: number | null } }
  | { ok: false; error: string } {
  const title = text(input?.title);
  const instructions = text(input?.instructions);
  if (!title) return { ok: false, error: "Enter a title." };
  if (title.length > TITLE_MAX) return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };
  if (instructions.length > INSTRUCTIONS_MAX) return { ok: false, error: `Keep the instructions under ${INSTRUCTIONS_MAX} characters.` };
  if (!validDate(input?.dueDate)) return { ok: false, error: "Choose a due date." };
  const link = cleanLink(input?.linkUrl);
  if (!link.ok) return { ok: false, error: `The link must start with https:// and be under ${LINK_MAX} characters.` };
  const max = cleanMaxMarks(input?.maxMarks);
  if (!max.ok) return { ok: false, error: `Maximum marks must be a number between 1 and ${MARKS_CEILING}.` };
  return { ok: true, value: { title, instructions, due_date: input.dueDate, link_url: link.value, max_marks: max.value } };
}

// Only a teacher sets homework: principal and office read it but do not write.
async function teacherSession() {
  const session = await getSession();
  if (!session || session.role !== "staff" || !session.staffId || session.isAdminScope) return null;
  return session;
}

export async function createHomework(input: HomeworkFields & { sectionId: number; subjectId: number }): Promise<Result> {
  const session = await teacherSession();
  if (!session) return fail("Only a teacher can set homework.");
  const year = await getCurrentYear();
  if (!year) return fail("No academic year is open.");

  if (!posInt(input?.sectionId) || !posInt(input?.subjectId)) return fail("Choose a class and a subject.");
  const scope = await getStaffScope();
  const meta = scope.sectionMeta.find((m) => m.id === input.sectionId);
  if (!meta || !meta.subjects.some((s) => s.id === input.subjectId)) {
    return fail("You can set homework only for a class and subject you teach.");
  }

  const fields = cleanFields(input);
  if (!fields.ok) return fail(fields.error);
  if (fields.value.due_date < schoolTodayISO()) return fail("The due date cannot be in the past.");

  const db = await untyped();
  const { error } = await db.from("homework").insert({
    ...fields.value,
    section_id: input.sectionId,
    subject_id: input.subjectId,
    academic_year_id: year.id,
    created_by: session.staffId,
  });
  if (error) return fail(GENERIC);
  revalidatePath("/dashboard/homework");
  return { ok: true };
}

// The teacher who set it may change the wording, date, link and marks; the
// class and subject stay as they were.
export async function updateHomework(id: number, input: HomeworkFields): Promise<Result> {
  const session = await teacherSession();
  if (!session) return fail("Only a teacher can change homework.");
  if (!posInt(id)) return fail("This homework no longer exists.");

  const fields = cleanFields(input);
  if (!fields.ok) return fail(fields.error);

  const db = await untyped();
  // Marks already given must still fit under the new maximum.
  const { data: top } = await db.from("homework_submission").select("marks")
    .eq("homework_id", id).not("marks", "is", null).order("marks", { ascending: false }).limit(1);
  const highest = top?.[0]?.marks != null ? Number(top[0].marks) : null;
  if (highest !== null) {
    if (fields.value.max_marks === null) return fail("Marks have already been given, so the maximum marks cannot be removed.");
    if (fields.value.max_marks < highest) return fail(`Marks up to ${highest} have already been given. Keep the maximum at or above that.`);
  }

  const { data, error } = await db.from("homework").update(fields.value)
    .eq("id", id).eq("created_by", session.staffId).select("id");
  if (error) return fail(GENERIC);
  if (!data?.length) return fail("You can change only the homework you set.");
  revalidatePath("/dashboard/homework");
  return { ok: true };
}

export async function deleteHomework(id: number): Promise<Result> {
  const session = await teacherSession();
  if (!session) return fail("Only a teacher can delete homework.");
  if (!posInt(id)) return fail("This homework no longer exists.");

  const db = await untyped();
  const { data, error } = await db.from("homework").delete()
    .eq("id", id).eq("created_by", session.staffId).select("id");
  if (error) return fail("Could not delete. Please try again.");
  if (!data?.length) return fail("You can delete only the homework you set.");
  revalidatePath("/dashboard/homework");
  return { ok: true };
}

// A student marks their own homework as done; a guardian may do it for a child.
export async function submitHomework(input: { homeworkId: number; studentId: number; note?: string | null; linkUrl?: string | null }): Promise<Result> {
  const session = await getSession();
  if (!session || (session.role !== "student" && session.role !== "guardian")) return fail("Only a student or guardian can submit homework.");
  if (!posInt(input?.homeworkId) || !posInt(input?.studentId)) return fail("This homework no longer exists.");

  if (session.role === "student") {
    if (session.studentId !== input.studentId) return fail("You can submit only your own homework.");
  } else {
    const children = await getMyChildren();
    if (!children.some((c) => c.id === input.studentId)) return fail("You can submit homework only for your own child.");
  }

  const note = text(input.note);
  if (note.length > NOTE_MAX) return fail(`Keep the note under ${NOTE_MAX} characters.`);
  const link = cleanLink(input.linkUrl);
  if (!link.ok) return fail(`The link must start with https:// and be under ${LINK_MAX} characters.`);

  const db = await untyped();
  const { error } = await db.rpc("homework_submit", {
    p_homework: input.homeworkId,
    p_student: input.studentId,
    p_note: note || null,
    p_link: link.value,
  });
  if (error) return fail(dbMessage(error));
  revalidatePath("/dashboard/homework");
  return { ok: true };
}

// The subject's teacher or the class teacher records marks and a remark.
export async function checkSubmission(input: { submissionId: number; marks?: number | string | null; remark?: string | null }): Promise<Result> {
  const session = await teacherSession();
  if (!session) return fail("Only a teacher can check homework.");
  if (!posInt(input?.submissionId)) return fail("This submission no longer exists.");

  const remark = text(input.remark);
  if (remark.length > REMARK_MAX) return fail(`Keep the remark under ${REMARK_MAX} characters.`);

  const db = await untyped();
  const { data: sub } = await db.from("homework_submission").select("homework_id").eq("id", input.submissionId).maybeSingle();
  if (!sub) return fail("This submission no longer exists.");
  const { data: hw } = await db.from("homework").select("section_id, subject_id, max_marks").eq("id", sub.homework_id).maybeSingle();
  if (!hw) return fail("This homework no longer exists.");

  const scope = await getStaffScope();
  const meta = scope.sectionMeta.find((m) => m.id === Number(hw.section_id));
  if (!meta || !(meta.isClassTeacher || meta.subjects.some((s) => s.id === Number(hw.subject_id)))) {
    return fail("Only the teacher of this subject or the class teacher can check this homework.");
  }

  let marks: number | null = null;
  const raw = input.marks;
  if (raw !== null && raw !== undefined && raw !== "") {
    const max = hw.max_marks != null ? Number(hw.max_marks) : null;
    if (max === null) return fail("This homework does not carry marks.");
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > max) return fail(`Marks must be between 0 and ${max}.`);
    marks = Math.round(n * 100) / 100;
  }

  const { error } = await db.rpc("homework_check", { p_submission: input.submissionId, p_marks: marks, p_remark: remark || null });
  if (error) return fail(dbMessage(error));
  revalidatePath("/dashboard/homework");
  return { ok: true };
}
