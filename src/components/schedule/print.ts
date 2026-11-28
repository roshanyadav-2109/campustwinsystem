// Timetables as PDF: a class's week, a teacher's week, or many in one file.
import type { PdfDoc } from "@/lib/pdf";
import { DAYS } from "@/components/schedule/shared";

export type PrintPeriod = { no: number; label: string; isBreak: boolean; start?: string };

export function timetablePdf(title: string, meta: string[], days: number[], periods: PrintPeriod[], cell: (day: number, period: number) => string): PdfDoc {
  return {
    filename: `Timetable ${title}`, title: `Timetable: ${title}`, meta, orientation: "landscape",
    blocks: [{
      kind: "table", headers: ["Day", ...periods.map((p) => `${p.label || p.no}${p.start ? ` ${p.start}` : ""}`)],
      rows: DAYS.filter((d) => days.includes(d.n)).map((d) => [d.short, ...periods.map((p) => (p.isBreak ? "Break" : cell(d.n, p.no) || "-"))]),
      compact: true,
    }],
  };
}
