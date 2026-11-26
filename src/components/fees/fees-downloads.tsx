"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ExcelIcon, ReportIcon } from "@/components/icons";
import { downloadXlsx } from "@/lib/xlsx";
import { downloadPdf, downloadPdfBook, type PdfDoc } from "@/lib/pdf";
import { Select } from "@/components/ui/field";
import { getTuitionCertificate } from "@/app/dashboard/fees/actions";
import { fmtDay, receiptPdf, round2, todayIST, type DueRow, type ReceiptData } from "@/components/fees/shared";

// Download one receipt as a PDF.
export function ReceiptButton({ receipt }: { receipt: ReceiptData }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true); setFailed(false);
    try { await downloadPdf(receiptPdf(receipt)); }
    catch (e) { console.error(e); setFailed(true); }
    finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="subtle" onClick={save} disabled={busy} aria-busy={busy} aria-label={`Download receipt ${receipt.receiptNo}`}>
        <ReportIcon size={16} /> {busy ? "Making PDF" : "Receipt"}
      </Button>
      {failed && <span role="alert" className="mt-1 text-[12px] text-down">Could not make the PDF. Please try again.</span>}
    </span>
  );
}

// Download the dues list on screen as an Excel sheet.
export function DuesExcelButton({ rows, label }: { rows: DueRow[]; label: string }) {
  return (
    <Button variant="subtle" disabled={!rows.length}
      onClick={() => downloadXlsx(
        `Fee dues ${label}`,
        ["Student", "Admission no.", "Class", "Open invoices", "Pending (Rs.)", "Oldest due date", "Overdue"],
        rows.map((r) => [r.name, r.admissionNo, r.classLabel, r.invoices, r.pending, fmtDay(r.oldestDue), r.overdue ? "Yes" : "No"]),
        "Dues",
      )}>
      <ExcelIcon size={18} /> Download Excel
    </Button>
  );
}

const rs = (n: number) => `Rs. ${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// One demand notice per student on the list, in a single PDF to print.
export function DemandNoticesButton({ rows, label }: { rows: DueRow[]; label: string }) {
  const [busy, setBusy] = useState(false);
  async function make() {
    setBusy(true);
    try {
      const today = todayIST(), payBy = addDays(today, 7);
      const docs: PdfDoc[] = rows.map((r) => ({
        filename: `Fee demand ${r.name}`, title: "Fee demand notice", meta: [`Date: ${fmtDay(today)}`],
        blocks: [
          { kind: "facts", items: [["Student", r.name], ["Admission no.", r.admissionNo], ["Class", r.classLabel]] },
          { kind: "text", lines: ["Dear parent,", "The following fees are pending. Please pay them at the school office by the date below. Please ignore this notice if you have paid in the last few days."] },
          { kind: "table", heading: "Pending fees", headers: ["Bill", "Due date", "Balance"], right: [2],
            rows: [...r.items.map((i) => [i.title, fmtDay(i.dueDate), rs(i.balance)]), ["Total pending", "", rs(r.pending)]] },
          { kind: "facts", items: [["Please pay by", fmtDay(payBy)]] },
          { kind: "text", lines: ["Accounts office"] },
        ],
      }));
      await downloadPdfBook(docs, `Fee demand notices ${label}`);
    } finally { setBusy(false); }
  }
  return <Button variant="subtle" disabled={!rows.length || busy} onClick={make}><ReportIcon size={18} /> {busy ? "Making PDF" : "Demand notices"}</Button>;
}

// Financial years from April: the current one and the three before it.
function fyOptions() {
  const t = todayIST(); const y = Number(t.slice(0, 4)); const start = Number(t.slice(5, 7)) >= 4 ? y : y - 1;
  return [0, 1, 2, 3].map((i) => start - i);
}

export function TuitionCertificateButton({ studentId }: { studentId: number }) {
  const years = fyOptions();
  const [fy, setFy] = useState(years[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function make() {
    setBusy(true); setError(null);
    try {
      const r = await getTuitionCertificate({ studentId, fyStartYear: fy });
      if (!r.ok) { setError(r.error); return; }
      await downloadPdf({
        filename: `Fee certificate ${r.name} ${r.fy}`, title: "Fee certificate", meta: [`Financial year ${r.fy} (1 April ${fy} to 31 March ${fy + 1})`, `Date: ${fmtDay(todayIST())}`],
        blocks: [
          { kind: "facts", items: [["Student", r.name], ["Admission no.", r.admissionNo], ...(r.parents.length ? [["Parent or guardian", r.parents.join(", ")] as [string, string]] : [])] },
          { kind: "table", headers: ["", "Amount"], right: [1], rows: [["Total fees paid in the year", rs(r.paid)], ["of which tuition fees", rs(r.tuition)]] },
          { kind: "text", lines: [
            `This is to certify that the fees shown above were paid to the school for ${r.name} during the financial year ${r.fy}.`,
            "Tuition fees exclude transport, late fees and other charges. This certificate is issued for income tax purposes (section 80C).",
            "This is a computer generated certificate.",
          ] },
        ],
      });
    } catch (e) { console.error(e); setError("Could not make the PDF. Please try again."); }
    finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Select className="h-8 w-32" aria-label="Financial year" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
        {years.map((y) => <option key={y} value={y}>{`${y}-${String((y + 1) % 100).padStart(2, "0")}`}</option>)}
      </Select>
      <Button size="sm" variant="subtle" disabled={busy} onClick={make}><ReportIcon size={16} /> {busy ? "Making PDF" : "Fee certificate"}</Button>
      {error && <span role="alert" className="text-[12px] text-down">{error}</span>}
    </span>
  );
}
