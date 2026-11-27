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
