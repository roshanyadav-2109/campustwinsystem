"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ExcelIcon, ReportIcon } from "@/components/icons";
import { downloadXlsx } from "@/lib/xlsx";
import { downloadPdf } from "@/lib/pdf";
import { fmtDay, receiptPdf, type DueRow, type ReceiptData } from "@/components/fees/shared";

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
