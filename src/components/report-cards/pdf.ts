// A published report card (its frozen snapshot) as a PDF document.
import type { PdfDoc, PdfBlock, PdfCell } from "@/lib/pdf";

export type CardSnapshot = {
  student: { name: string; admission_no: string | null; roll_no: number | null };
  scheme: { name: string; board: string | null; show_marks: boolean; show_grades: boolean; show_percent: boolean };
  term: number; term_name: string; class?: string; year?: string; class_teacher?: string | null;
  school?: { name: string; place?: string | null; board?: string | null; affiliation_no?: string | null; school_code?: string | null; udise?: string | null; signatory?: string | null; signatory_title?: string | null };
  subjects: { subject: string; counted: boolean; components: { id?: number; name: string; term: number; out_of: number; score: number | null; exempt?: boolean; absent?: boolean }[]; total: number | null; max: number | null; percent: number | null; grade: string | null; passed: boolean | null }[];
  term_names?: Record<string, string>;
  total: number | null; max: number | null; percent: number | null; grade: string | null; result: string | null;
  attendance: { present: number; working: number } | null;
  coscholastic: { area: string; term: number; grade: string }[];
  remark: string | null; result_text?: string | null;
};

const num = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""));

const compCell = (c: { score: number | null; out_of: number; exempt?: boolean; absent?: boolean }) =>
  c.exempt ? "Ex" : c.absent ? "AB" : c.score == null ? "-" : `${num(c.score)}/${num(c.out_of)}`;

export function reportCardPdf(s: CardSnapshot, verifyUrl: string, photo?: string | null): PdfDoc {
  const show = s.scheme;
  let headers: string[];
  let rows: PdfCell[][];
  if (s.term === 0) {
    // year-end card: one column per term (that term's parts added up), then the total
    const terms = [...new Set(s.subjects.flatMap((x) => x.components.map((c) => c.term)))].sort((a, b) => a - b);
    headers = ["Subject", ...(show.show_marks ? terms.map((t) => s.term_names?.[String(t)] ?? `Term ${t}`) : []), ...(show.show_marks ? ["Total"] : []), ...(show.show_percent ? ["%"] : []), ...(show.show_grades ? ["Grade"] : [])];
    rows = s.subjects.map((sub) => {
      const cells: PdfCell[] = [sub.counted ? sub.subject : `${sub.subject} *`];
      if (show.show_marks) {
        for (const t of terms) {
          const parts = sub.components.filter((c) => c.term === t && c.score != null);
          cells.push(parts.length ? `${num(parts.reduce((n, c) => n + (c.score ?? 0), 0))}/${num(parts.reduce((n, c) => n + c.out_of, 0))}` : "-");
        }
        cells.push(sub.total == null ? "-" : `${num(sub.total)}/${num(sub.max)}`);
      }
      if (show.show_percent) cells.push(sub.percent == null ? "-" : num(sub.percent));
      if (show.show_grades) cells.push(sub.passed === false ? { text: sub.grade ?? "-", low: true } : sub.grade ?? "-");
      return cells;
    });
  } else {
    // a term card: one column per part, keyed by the part (two parts may share a name)
    const parts: { key: string; label: string }[] = [];
    for (const sub of s.subjects) for (const c of sub.components) {
      const key = c.id != null ? String(c.id) : c.name;
      if (!parts.some((p) => p.key === key)) parts.push({ key, label: c.name });
    }
    headers = ["Subject", ...(show.show_marks ? parts.map((p) => p.label) : []), ...(show.show_marks ? ["Total"] : []), ...(show.show_percent ? ["%"] : []), ...(show.show_grades ? ["Grade"] : [])];
    rows = s.subjects.map((sub) => {
      const byKey = new Map(sub.components.map((c) => [c.id != null ? String(c.id) : c.name, c]));
      const cells: PdfCell[] = [sub.counted ? sub.subject : `${sub.subject} *`];
      if (show.show_marks) {
        for (const p of parts) { const c = byKey.get(p.key); cells.push(c ? compCell(c) : ""); }
        cells.push(sub.total == null ? "-" : `${num(sub.total)}/${num(sub.max)}`);
      }
      if (show.show_percent) cells.push(sub.percent == null ? "-" : num(sub.percent));
      if (show.show_grades) cells.push(sub.passed === false ? { text: sub.grade ?? "-", low: true } : sub.grade ?? "-");
      return cells;
    });
  }
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
  if (s.result_text) overall.push(["Result", s.result_text]);
  else if (s.result) overall.push(["Result", s.result === "pass" ? "Pass" : "Needs improvement"]);

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
  return { filename: `Report card ${s.student.name} ${s.term_name}`, title: "Report card", meta, blocks, school: s.school?.name, photo: photo ?? null };
}
