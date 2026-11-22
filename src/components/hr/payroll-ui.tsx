"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ExcelIcon, ReportIcon } from "@/components/icons";
import { downloadXlsx } from "@/lib/xlsx";
import { downloadPdf, type PdfDoc } from "@/lib/pdf";
import { finalisePayroll, preparePayroll } from "@/app/dashboard/hr/actions";

export type RegisterExport = { filename: string; sheetName: string; headers: string[]; rows: (string | number | null)[][] };

// Month chooser plus the office's payroll buttons. `status` is the state of
// the chosen month's run: none yet, draft, or finalised.
export function PayrollBar({
  month, maxMonth, status, canEdit, hasSlips, register,
}: {
  month: string; // YYYY-MM
  maxMonth: string;
  status: "none" | "draft" | "finalised";
  canEdit: boolean;
  hasSlips: boolean;
  register?: RegisterExport;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  function prepare() {
    setError(null); setConfirm(false);
    start(async () => {
      const res = await preparePayroll(month);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function finalise() {
    setError(null);
    start(async () => {
      const res = await finalisePayroll(month);
      if (!res.ok) setError(res.error);
      setConfirm(false);
      router.refresh();
    });
  }

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field label="Month" htmlFor="hr-payroll-month">
            <Input id="hr-payroll-month" type="month" value={month} max={maxMonth}
              onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) router.push(`/dashboard/hr?view=payroll&month=${e.target.value}`); }} />
          </Field>
        </div>
        {canEdit && status !== "finalised" && (
          <Button onClick={prepare} disabled={pending} variant={status === "draft" ? "subtle" : "primary"}>
            {pending && !confirm ? "Working" : status === "draft" ? "Prepare again" : "Prepare payroll"}
          </Button>
        )}
        {canEdit && status === "draft" && hasSlips && !confirm && (
          <Button onClick={() => setConfirm(true)} disabled={pending}>Finalise</Button>
        )}
        {register && (
          <Button variant="subtle" onClick={() => downloadXlsx(register.filename, register.headers, register.rows, register.sheetName)}>
            <ExcelIcon size={18} /> Download Excel
          </Button>
        )}
      </div>
      {confirm && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-sm border border-hair bg-panel px-3 py-2">
          <span className="text-[13px] text-ink-900">Finalising locks this month and shows each staff member their payslip. It cannot be undone.</span>
          <Button size="sm" disabled={pending} onClick={finalise}>{pending ? "Finalising" : "Yes, finalise"}</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>Not yet</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] font-medium text-down">{error}</p>}
    </div>
  );
}

// Turns a payslip (described by the server as a PdfDoc) into a PDF download.
export function PayslipPdfButton({ doc }: { doc: PdfDoc }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true); setFailed(false);
    try { await downloadPdf(doc); }
    catch (e) { console.error(e); setFailed(true); }
    finally { setBusy(false); }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="subtle" onClick={save} disabled={busy} aria-busy={busy}>
        <ReportIcon size={18} /> {busy ? "Making PDF" : "Download PDF"}
      </Button>
      {failed && <span role="alert" className="text-[12px] text-down">The PDF could not be made. Please try again.</span>}
    </span>
  );
}
