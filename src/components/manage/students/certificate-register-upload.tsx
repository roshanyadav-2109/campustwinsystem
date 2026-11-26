"use client";
import { readSpreadsheet, SpreadsheetError } from "@/lib/xlsx-read";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExcelIcon } from "@/components/icons";
import { parseCsv } from "@/app/dashboard/students/manage/rules";
import { importCertificateRegister, type RegisterRow } from "@/app/dashboard/students/[id]/certificates/actions";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const KIND: Record<string, string> = {
  transfer: "transfer", tc: "transfer", transfercertificate: "transfer", leaving: "transfer", lc: "transfer", schoolleavingcertificate: "transfer",
  bonafide: "bonafide", bc: "bonafide", bonafidecertificate: "bonafide", character: "character", cc: "character", charactercertificate: "character",
};
function isoDate(v: string): string | null {
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
const col = (header: string[], names: string[]) => header.findIndex((h) => names.includes(h));

function read(table: string[][]): { rows: RegisterRow[]; problem?: string } {
  const t = table.filter((r) => r.some((c) => c.trim()));
  if (t.length < 2) return { rows: [], problem: "The file has no rows under the headings." };
  const h = t[0].map(squash);
  const a = col(h, ["admissionno", "admissionnumber", "admno", "grno", "generalregisterno", "srno"]);
  const k = col(h, ["certificate", "type", "kind", "certificatetype"]);
  const n = col(h, ["number", "certificateno", "certificatenumber", "no", "tcno", "slno"]);
  const d = col(h, ["dateofissue", "issuedon", "date", "issuedate"]);
  if (a < 0 || n < 0 || d < 0) return { rows: [], problem: "The file needs the columns Admission no, Number and Date of issue (and Certificate for the type)." };
  return {
    rows: t.slice(1).map((r, i) => {
      const row: RegisterRow = { line: i + 2, admissionNo: (r[a] ?? "").trim(), kind: k >= 0 ? (KIND[squash(r[k] ?? "")] ?? "") : "transfer", number: (r[n] ?? "").trim(), issuedOn: isoDate(r[d] ?? "") ?? "", errors: [] };
      if (!row.admissionNo) row.errors.push("admission no is empty");
      if (!row.kind) row.errors.push("certificate type is not Transfer, Bonafide or Character");
      if (!row.number) row.errors.push("number is empty");
      if (!row.issuedOn) row.errors.push("date of issue is not a date");
      return row;
    }),
  };
}

function template() {
  const blob = new Blob(["﻿Admission no,Certificate,Number,Date of issue\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url; el.download = "certificate-register-template.csv";
  document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
}

// The school's old certificate register: certificates issued before CampusTwin,
// recorded against each student (files can be attached later on the student).
export function CertificateRegisterUpload() {
  const inputId = useId();
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const bad = rows?.filter((r) => r.errors.length) ?? [];
  const list = (xs: string[]) => `${xs.slice(0, 8).join(", ")}${xs.length > 8 ? " and more" : ""}`;
  return (
    <Card>
      <CardHeader title="Import certificate register" action={<Button size="sm" variant="ghost" onClick={template}><ExcelIcon size={16} /> Template</Button>} />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-700">Certificates the school issued before using CampusTwin: admission number, certificate (Transfer, Bonafide or Character), its number and date of issue. A scanned copy can be attached later on each student.</p>
        <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-hair bg-surface px-3 py-2 text-[14px] font-medium text-ink-900 hover:bg-panel"><ExcelIcon size={18} /> Choose an Excel or CSV file</label>
        <input id={inputId} type="file" accept=".xlsx,.csv,text/csv" className="sr-only" onChange={async (e) => {
          setRows(null); setMsg(null);
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const r = read(await readSpreadsheet(f, parseCsv));
            if (r.problem) setMsg({ ok: false, text: r.problem }); else setRows(r.rows);
          } catch (err) {
            setMsg({ ok: false, text: err instanceof SpreadsheetError ? err.message : "We could not read this file." });
          }
        }} />
        {rows && (
          <div className="space-y-2">
            <p className="text-[14px] text-ink-900">{rows.length} certificates{bad.length ? `, ${bad.length} with problems` : ""}.</p>
            {bad.length > 0 && <ul className="max-h-40 overflow-y-auto rounded-sm border border-hair p-2 text-[13px] text-down">{bad.slice(0, 100).map((r) => <li key={r.line}>Line {r.line}: {r.errors.join("; ")}</li>)}</ul>}
            <Button disabled={pending || bad.length > 0} onClick={() => start(async () => {
              const r = await importCertificateRegister(rows);
              if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
              setRows(null);
              setMsg({ ok: true, text: `${r.added} recorded.${r.skipped.length ? ` Skipped: ${list(r.skipped)}.` : ""}${r.unknown.length ? ` Admission numbers not found: ${list(r.unknown)}.` : ""}` });
            })}>{pending ? "Importing…" : "Import"}</Button>
          </div>
        )}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
