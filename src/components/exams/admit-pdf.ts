// An admit card as a PDF document (one page per student).
import type { PdfDoc } from "@/lib/pdf";

export type AdmitPaper = { date: string; start: string; end: string; subject: string; note: string | null };

const day = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${iso.split("-").reverse().join("/")} (${d.toLocaleDateString("en-IN", { weekday: "short" })})`;
};
const hm = (t: string) => t.slice(0, 5);

export function admitCardPdf(a: { exam: string; school: string; student: string; admissionNo: string; roll: number | null; classLabel: string; instructions: string | null; papers: AdmitPaper[]; verifyUrl: string }): PdfDoc {
  return {
    filename: `Admit card ${a.student} ${a.exam}`,
    title: "Admit card",
    meta: [a.exam],
    school: a.school,
    blocks: [
      { kind: "facts", items: [["Student", a.student], ["Class", a.classLabel], ["Roll no.", a.roll == null ? "-" : String(a.roll)], ["Admission no.", a.admissionNo]] },
      { kind: "table", heading: "Date sheet", headers: ["Date", "Time", "Subject", "Note"],
        rows: a.papers.map((p) => [day(p.date), `${hm(p.start)} to ${hm(p.end)}`, p.subject, p.note ?? ""]) },
      ...(a.instructions ? [{ kind: "text" as const, heading: "Instructions", lines: a.instructions.split(/\r?\n/).filter(Boolean) }] : []),
      { kind: "signatures", labels: ["Student", "Class teacher", "Principal"] },
      { kind: "qr", data: a.verifyUrl, lines: ["Scan to check this admit card.", a.verifyUrl.replace(/^https:\/\//, "")] },
    ],
  };
}
