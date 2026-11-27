// A semester grade card as a PDF document.
import type { PdfDoc } from "@/lib/pdf";
import type { GradeCard } from "@/lib/data/results";

const n = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(2).replace(/\.?0+$/, ""));

export function gradeCardPdf(c: GradeCard, verifyUrl: string, signers: string[] = ["Controller of Examinations", "Principal"]): PdfDoc {
  return {
    filename: `Grade card ${c.student} semester ${c.semester_no ?? ""}`,
    title: "Grade card",
    meta: [c.programme ?? "", c.semester_no ? `Semester ${c.semester_no}` : ""].filter(Boolean),
    school: c.school,
    blocks: [
      { kind: "facts", items: [["Student", c.student], ["Admission no.", c.admission_no], ["Programme", c.programme ?? "-"], ["Semester", c.semester_no ? String(c.semester_no) : "-"]] },
      { kind: "table", heading: "Courses", headers: ["Code", "Course", "Credits", "Internal", "End-semester", "Grade", "Points"], right: [2, 3, 4, 6],
        rows: c.courses.map((x) => [x.code, x.name, n(x.credits), x.cia == null ? "-" : `${n(x.cia)}/${n(x.cia_max)}`, x.ese == null ? "-" : `${n(x.ese)}/${n(x.ese_max)}`,
          x.passed ? x.grade : { text: x.grade, low: true }, n(x.point)]) },
      { kind: "facts", heading: "Result", items: [["Credits registered", n(c.credits_registered)], ["Credits earned", n(c.credits_earned)], ["SGPA", n(c.sgpa)], ["CGPA", n(c.cgpa)],
        ["Backlogs", String(c.backlogs)], ["Result", c.backlogs ? `To reappear in ${c.backlogs} course${c.backlogs > 1 ? "s" : ""}` : "Pass"]] },
      { kind: "signatures", labels: signers },
      { kind: "qr", data: verifyUrl, lines: ["Scan to check this grade card.", verifyUrl.replace(/^https:\/\//, "")] },
    ],
  };
}

export type ConsolidatedRow = { semester_id: number; semester_no: number | null; course_code: string; course_name: string; credits: number; grade: string; point: number; attempt: number; kind: string; passed: boolean };

// All semesters, the counted attempt of every course; SGPA per semester from those grades.
export function consolidatedPdf(student: { name: string; admission_no: string; programme: string | null; school: string }, rows: ConsolidatedRow[],
  standing: { cgpa: number | null; credits_earned: number; backlogs: number } | null, percent: number | null, transcript?: { verifyUrl: string; signers: string[] }): PdfDoc {
  const sems = [...new Set(rows.map((r) => r.semester_no ?? 0))].sort((a, b) => a - b);
  const sg = (no: number) => { const l = rows.filter((r) => (r.semester_no ?? 0) === no); const cr = l.reduce((a, r) => a + Number(r.credits), 0); return cr ? l.reduce((a, r) => a + Number(r.credits) * Number(r.point), 0) / cr : null; };
  return {
    filename: `${transcript ? "Transcript" : "Consolidated marksheet"} ${student.name}`, title: transcript ? "Transcript" : "Consolidated marksheet", meta: [student.programme ?? ""].filter(Boolean), school: student.school,
    blocks: [
      { kind: "facts", items: [["Student", student.name], ["Admission no.", student.admission_no], ["Programme", student.programme ?? "-"]] },
      { kind: "grouped", heading: "Courses (the attempt that counts)", headers: ["Code", "Course", "Credits", "Grade", "Points", "Attempt"], right: [2, 4, 5],
        groups: sems.map((no) => ({ label: `Semester ${no || "-"}${sg(no) != null ? `, SGPA ${sg(no)!.toFixed(2)}` : ""}`,
          rows: rows.filter((r) => (r.semester_no ?? 0) === no).map((r) => [r.course_code, r.course_name, n(r.credits), r.passed ? r.grade : { text: r.grade, low: true }, n(r.point), r.attempt > 1 ? `${r.attempt} (${r.kind})` : "1"]) })) },
      { kind: "facts", heading: "Standing", items: [["CGPA", n(standing?.cgpa)], ...(percent != null ? [["Percentage equivalent", `${n(percent)}%`] as [string, string]] : []),
        ["Credits earned", n(standing?.credits_earned)], ["Backlogs", String(standing?.backlogs ?? 0)]] },
      { kind: "signatures", labels: transcript?.signers ?? ["Controller of Examinations", "Registrar"] },
      ...(transcript ? [{ kind: "qr" as const, data: transcript.verifyUrl, lines: ["Scan to check this transcript.", transcript.verifyUrl.replace(/^https:\/\//, "")] }] : []),
    ],
  };
}

export type SuppResultRow = { session_id: number; session_name: string; kind: string; published_on: string; course_code: string; course_name: string; credits: number; attempt: number; grade: string; point: number; passed: boolean; counts: boolean };

export function suppMemoPdf(student: { name: string; admission_no: string; programme: string | null; school: string }, rows: SuppResultRow[], signers: string[]): PdfDoc {
  const first = rows[0];
  return {
    filename: `${first?.kind === "improvement" ? "Improvement" : "Supplementary"} memo ${student.name} ${first?.session_name ?? ""}`,
    title: first?.kind === "improvement" ? "Improvement exam memo" : "Supplementary exam memo", meta: [first?.session_name ?? ""], school: student.school,
    blocks: [
      { kind: "facts", items: [["Student", student.name], ["Admission no.", student.admission_no], ["Programme", student.programme ?? "-"], ["Published", first?.published_on ?? "-"]] },
      { kind: "table", heading: "Courses", headers: ["Code", "Course", "Credits", "Attempt", "Grade", "Points", "Counts"], right: [2, 3, 5],
        rows: rows.map((r) => [r.course_code, r.course_name, n(r.credits), String(r.attempt), r.passed ? r.grade : { text: r.grade, low: true }, n(r.point), r.counts ? "Yes" : "No (earlier grade kept)"]) },
      { kind: "signatures", labels: signers },
    ],
  };
}
