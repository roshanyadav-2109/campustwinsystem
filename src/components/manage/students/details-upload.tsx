"use client";
import { readSpreadsheet, SpreadsheetError } from "@/lib/xlsx-read";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExcelIcon } from "@/components/icons";
import { importStudentDetails } from "@/app/dashboard/students/manage/actions";
import { parseCsv } from "@/app/dashboard/students/manage/rules";
import { DETAILS_TEMPLATE, readDetails, type DetailsRow } from "@/app/dashboard/students/manage/details-rules";

function downloadTemplate() {
  const blob = new Blob(["﻿" + DETAILS_TEMPLATE.join(",") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "student-details-template.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Add details to students already on the roll: admission no plus any of the
// profile columns. Empty cells leave what is saved alone.
export function DetailsUpload() {
  const inputId = useId();
  const [rows, setRows] = useState<DetailsRow[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function choose(file: File | undefined) {
    setRows(null); setMsg(null);
    if (!file) return;
    try {
      const res = readDetails(await readSpreadsheet(file, parseCsv));
      if (res.problem) { setMsg({ ok: false, text: res.problem }); return; }
      if (res.rows.length > 3000) { setMsg({ ok: false, text: "Please upload at most 3000 students at a time." }); return; }
      setRows(res.rows); setColumns(res.columns);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SpreadsheetError ? e.message : "We could not read this file. Please check it is an Excel or CSV file." });
    }
  }
  const bad = rows?.filter((r) => r.errors.length) ?? [];
  const save = () => rows && start(async () => {
    const res = await importStudentDetails(rows);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    setRows(null);
    setMsg({ ok: true, text: `Details saved for ${res.updated} ${res.updated === 1 ? "student" : "students"}.${res.unknown.length ? ` Not found: ${res.unknown.slice(0, 10).join(", ")}${res.unknown.length > 10 ? ` and ${res.unknown.length - 10} more` : ""}.` : ""}` });
  });

  return (
    <Card>
      <CardHeader title="Upload more details" action={<Button size="sm" variant="ghost" onClick={downloadTemplate}><ExcelIcon size={16} /> Template</Button>} />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-700">For students already on the roll: admission number plus any of date of admission, previous school, address, blood group, emergency contact, APAAR ID, PEN, Aadhaar, category and more. Empty cells leave saved details as they are. Only the last 4 digits of Aadhaar are kept.</p>
        <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-hair bg-surface px-3 py-2 text-[14px] font-medium text-ink-900 hover:bg-panel">
          <ExcelIcon size={18} /> Choose an Excel or CSV file
        </label>
        <input id={inputId} aria-label="File of more student details" type="file" accept=".xlsx,.csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
        {rows && (
          <div className="space-y-2">
            <p className="text-[14px] text-ink-900">{rows.length} {rows.length === 1 ? "row" : "rows"}, {columns.length} {columns.length === 1 ? "column" : "columns"} of details{bad.length ? `, ${bad.length} with problems` : ""}.</p>
            {bad.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded-sm border border-hair p-2 text-[13px] text-down">
                {bad.slice(0, 100).map((r) => <li key={r.line}>Line {r.line} ({r.admissionNo || "no admission no"}): {r.errors.join("; ")}</li>)}
              </ul>
            )}
            <Button disabled={pending || bad.length > 0} onClick={save}>{pending ? "Saving…" : "Save details"}</Button>
          </div>
        )}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
