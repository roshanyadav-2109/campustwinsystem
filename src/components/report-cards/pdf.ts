// A published report card (its frozen snapshot) as a PDF document.
import type { PdfDoc, PdfBlock, PdfCell } from "@/lib/pdf";

export type CardSnapshot = {
  student: { name: string; admission_no: string | null; roll_no: number | null };
  scheme: { name: string; board: string | null; show_marks: boolean; show_grades: boolean; show_percent: boolean };
  term: number; term_name: string; class?: string; year?: string; class_teacher?: string | null;
  school?: { name: string; place?: string | null; board?: string | null; affiliation_no?: string | null; school_code?: string | null; udise?: string | null; signatory?: string | null; signatory_title?: string | null };
  subjects: { subject: string; counted: boolean; components: { name: string; term: number; out_of: number; score: number | null; exempt?: boolean }[]; total: number | null; max: number | null; percent: number | null; grade: string | null; passed: boolean | null }[];
  total: number | null; max: number | null; percent: number | null; grade: string | null; result: string | null;
  attendance: { present: number; working: number } | null;
  coscholastic: { area: string; term: number; grade: string }[];
  remark: string | null; result_text?: string | null;
};

const num = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""));

export function reportCardPdf(s: CardSnapshot, verifyUrl: string): PdfDoc {
  const show = s.scheme;
  // one column per component name (in order of first appearance)
  const compNames: string[] = [];
  for (const sub of s.subjects) for (const c of sub.components) {
    const label = s.term === 0 ? `${c.name} (T${c.term})` : c.name;
    if (!compNames.includes(label)) compNames.push(label);
  }
  const headers = ["Subject", ...(show.show_marks ? compNames : []), ...(show.show_marks ? ["Total"] : []), ...(show.show_percent ? ["%"] : []), ...(show.show_grades ? ["Grade"] : [])];
  const rows: PdfCell[][] = s.subjects.map((sub) => {
    const byName = new Map(sub.components.map((c) => [s.term === 0 ? `${c.name} (T${c.term})` : c.name, c]));
    const cells: PdfCell[] = [sub.counted ? sub.subject : `${sub.subject} *`];
    if (show.show_marks) {
      for (const n of compNames) { const c = byName.get(n); cells.push(c ? (c.exempt ? "Ex" : c.score == null ? "-" : `${num(c.score)}/${num(c.out_of)}`) : ""); }
      cells.push(sub.total == null ? "-" : `${num(sub.total)}/${num(sub.max)}`);
    }
    if (show.show_percent) cells.push(sub.percent == null ? "-" : num(sub.percent));
    if (show.show_grades) cells.push(sub.passed === false ? { text: sub.grade ?? "-", low: true } : sub.grade ?? "-");
    return cells;
  });
  const right = headers.map((_, i) => i).filter((i) => i > 0);
  const facts: [string, string][] = [
    ["Student", s.student.name], ["Class", s.class ?? "-"], ["Admission no.", s.student.admission_no ?? "-"],
    ["Roll no.", s.student.roll_no == null ? "-" : String(s.student.roll_no)], ["Year", s.year ?? "-"],
  ];
  if (s.attendance) facts.push(["Attendance", `${s.attendance.present} of ${s.attendance.working} days`]);
  const overall: [string, string][] = [];
  if (show.show_marks && s.max) overall.push(["Total", `${num(s.total)} of ${num(s.max)}`]);
  if (show.show_percent && s.percent != null) overall.push(["Percent", `${num(s.percent)}%`]);
  if (show.show_grades && s.grade) overall.push(["Grade", s.grade]);
  if (s.result) overall.push(["Result", s.result === "pass" ? "Pass" : "Needs improvement"]);
  if (s.result_text) overall.push(["Result", s.result_text]);

  const blocks: PdfBlock[] = [
    { kind: "facts", items: facts },
    { kind: "table", heading: "Scholastic", headers, rows, right },
  ];
  if (s.subjects.some((x) => !x.counted)) blocks.push({ kind: "text", lines: ["* Shown on the card; not counted in the total."] });
  if (overall.length) blocks.push({ kind: "facts", heading: "Overall", items: overall });
  if (s.coscholastic.length) {
    blocks.push({ kind: "table", heading: "Co-scholastic", headers: s.term === 0 ? ["Area", "Term", "Grade"] : ["Area", "Grade"],
      rows: s.coscholastic.map((c) => (s.term === 0 ? [c.area, `T${c.term}`, c.grade] : [c.area, c.grade])), compact: true });
  }
  if (s.remark) blocks.push({ kind: "text", heading: "Class teacher's remark", lines: [s.remark] });
  blocks.push({ kind: "signatures", labels: [s.class_teacher ? `Class teacher (${s.class_teacher})` : "Class teacher", s.school?.signatory_title || "Principal", "Parent"] });
  blocks.push({ kind: "qr", data: verifyUrl, lines: ["Scan to check this report card is genuine.", verifyUrl.replace(/^https:\/\//, "")] });
  const meta = [s.term_name, s.year ?? "", [s.scheme.board, s.school?.affiliation_no ? `Affiliation ${s.school.affiliation_no}` : ""].filter(Boolean).join(", ")].filter(Boolean);
  return { filename: `Report card ${s.student.name} ${s.term_name}`, title: "Report card", meta, blocks, school: s.school?.name };
}
