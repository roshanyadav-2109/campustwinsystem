"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

// Marks in Excel for a whole section and term: one column per exam of every
// subject. Download, fill in, upload. The database decides who may write which
// column (subject teacher, class teacher, office) and refuses locked terms.
type Assess = { id: number; name: string; max_marks: number; subject: { name: string } | null };
const TAG = /\[#(\d+)\]\s*$/;

async function load(sectionId: number, yearId: number, term: number) {
  const supabase = await createClient();
  const { data: aData, error } = await supabase.from("assessment")
    .select("id, name, max_marks, assessed_on, subject:subject_id(name)")
    .eq("section_id", sectionId).eq("academic_year_id", yearId).eq("term", term)
    .order("subject_id").order("assessed_on").limit(500);
  if (error) return null;
  const assessments = (aData ?? []) as unknown as Assess[];
  const { data: kids } = await supabase.from("student_enrollment")
    .select("roll_no, student:student_id(id, full_name, admission_no)").eq("section_id", sectionId).eq("academic_year_id", yearId).limit(1000);
  const students = ((kids ?? []) as unknown as { roll_no: number | null; student: { id: number; full_name: string; admission_no: string } }[])
    .sort((a, b) => (a.roll_no ?? 9999) - (b.roll_no ?? 9999) || a.student.full_name.localeCompare(b.student.full_name));
  return { supabase, assessments, students };
}

export async function marksSheet(input: { sectionId: number; yearId: number; term: number }) {
  if (!(await getSession())) return { ok: false as const, error: "Please sign in again." };
  const l = await load(input.sectionId, input.yearId, input.term);
  if (!l) return { ok: false as const, error: "Could not read the exams." };
  if (!l.assessments.length) return { ok: false as const, error: "This term has no exams for this section yet." };
  // all marks, page by page (the API returns at most 1000 rows at a time)
  const ids = l.assessments.map((a) => a.id);
  const marks: { assessment_id: number; student_id: number; marks_obtained: number | null; is_absent: boolean; is_exempt: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await l.supabase.from("mark").select("assessment_id, student_id, marks_obtained, is_absent, is_exempt" as "assessment_id, student_id, marks_obtained, is_absent")
      .in("assessment_id", ids).order("id").range(from, from + 999);
    const page = (data ?? []) as unknown as typeof marks;
    marks.push(...page);
    if (page.length < 1000) break;
  }
  const at = new Map(marks.map((m) => [`${m.assessment_id}:${m.student_id}`, m]));
  const headers = ["Admission no", "Roll", "Name", ...l.assessments.map((a) => `${a.subject?.name ?? "Subject"} - ${a.name} (out of ${Number(a.max_marks)}) [#${a.id}]`)];
  const rows = l.students.map((s) => [
    s.student.admission_no, s.roll_no ?? "", s.student.full_name,
    ...l.assessments.map((a) => {
      const m = at.get(`${a.id}:${s.student.id}`);
      return !m ? "" : m.is_exempt ? "EX" : m.is_absent ? "AB" : m.marks_obtained ?? "";
    }),
  ]);
  return { ok: true as const, headers, rows };
}

export type SheetProblem = { row: number; column: string; problem: string };

export async function importMarksSheet(input: { sectionId: number; yearId: number; term: number; rows: string[][] }) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Please sign in again." };
  if (!Array.isArray(input.rows) || input.rows.length < 2 || input.rows.length > 1001) return { ok: false as const, error: "The file has no student rows." };
  const l = await load(input.sectionId, input.yearId, input.term);
  if (!l) return { ok: false as const, error: "Could not read the exams." };
  const head = input.rows[0].map((h) => String(h ?? "").trim());
  const admCol = head.findIndex((h) => /^admission/i.test(h));
  if (admCol < 0) return { ok: false as const, error: "The first row must have an \"Admission no\" column. Download the sheet from here and fill it in." };
  const byId = new Map(l.assessments.map((a) => [a.id, a]));
  const cols: { idx: number; a: Assess; label: string }[] = [];
  head.forEach((h, idx) => { const m = TAG.exec(h); if (m && byId.has(Number(m[1]))) cols.push({ idx, a: byId.get(Number(m[1]))!, label: h.replace(TAG, "").trim() }); });
  if (!cols.length) return { ok: false as const, error: "No exam columns found. Download the sheet from here so each column carries its exam code." };
  const kidByAdm = new Map(l.students.map((s) => [s.student.admission_no.trim().toUpperCase(), s.student.id]));

  const problems: SheetProblem[] = [];
  const perAssessment = new Map<number, { assessment_id: number; student_id: number; marks_obtained: number | null; is_absent: boolean; is_exempt: boolean; entered_by: number | null }[]>();
  input.rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const adm = String(r[admCol] ?? "").trim().toUpperCase();
    if (!adm && r.every((c) => !String(c ?? "").trim())) return;   // empty line
    const sid = kidByAdm.get(adm);
    if (!sid) { problems.push({ row: rowNo, column: "Admission no", problem: `${adm || "(empty)"} is not in this section` }); return; }
    for (const c of cols) {
      const raw = String(r[c.idx] ?? "").trim();
      if (raw === "") continue;   // blank: leave as it is
      let m: number | null = null, absent = false, exempt = false;
      if (/^(ab|a|absent)$/i.test(raw)) absent = true;
      else if (/^(ex|exempt|ml)$/i.test(raw)) exempt = true;
      else {
        const n = Number(raw.replace(",", "."));
        if (!Number.isFinite(n) || n < 0) { problems.push({ row: rowNo, column: c.label, problem: `"${raw}" is not a mark (use a number, AB or EX)` }); continue; }
        if (n > Number(c.a.max_marks)) { problems.push({ row: rowNo, column: c.label, problem: `${n} is more than ${Number(c.a.max_marks)}` }); continue; }
        if (Math.round(n * 100) !== n * 100) { problems.push({ row: rowNo, column: c.label, problem: `${n}: use at most two decimals` }); continue; }
        m = n;
      }
      const list = perAssessment.get(c.a.id) ?? [];
      list.push({ assessment_id: c.a.id, student_id: sid, marks_obtained: m, is_absent: absent, is_exempt: exempt, entered_by: session.staffId ?? null });
      perAssessment.set(c.a.id, list);
    }
  });
  if (problems.length) return { ok: true as const, saved: 0, problems: problems.slice(0, 200), refused: [] as string[] };

  // save exam by exam: a column this person may not change is reported, the rest saved
  let saved = 0;
  const refused: string[] = [];
  for (const [aid, rows] of perAssessment) {
    const { error } = await l.supabase.from("mark").upsert(rows as never, { onConflict: "assessment_id,student_id" });
    const label = cols.find((c) => c.a.id === aid)?.label ?? `exam ${aid}`;
    if (error) refused.push(error.message.includes("locked") ? `${label}: the term is locked` : `${label}: you cannot change these marks`);
    else saved += rows.length;
  }
  revalidatePath("/dashboard/marks");
  revalidatePath("/dashboard/report-cards");
  return { ok: true as const, saved, problems: [] as SheetProblem[], refused };
}
