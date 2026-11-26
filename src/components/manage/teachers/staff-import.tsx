"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readSpreadsheet, SpreadsheetError } from "@/lib/xlsx-read";
import { parseCsv } from "@/app/dashboard/students/manage/rules";
import { importStaff, type StaffImportRow } from "@/app/dashboard/settings/teachers/actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExcelIcon } from "@/components/icons";
import type { StaffRole } from "@/lib/session";

const HEADERS = ["Full name", "Role", "Employee code", "Email", "Phone"];
type Checked = { line: number; row: StaffImportRow; errors: string[] };

// The words people actually write in a sheet, turned into a role.
function roleOf(raw: string): StaffRole | null {
  const s = raw.trim().toLowerCase();
  if (!s || /^(subject )?teacher|^tgt|^pgt|^prt|faculty|lecturer/.test(s)) return "subject_teacher";
  if (/class ?teacher/.test(s)) return "class_teacher";
  if (/principal|head ?(master|mistress)|headmaster|director/.test(s)) return "principal";
  if (/office|clerk|account|admin|reception|cashier/.test(s)) return "office";
  if (/driver|conductor|transport|attendant/.test(s)) return "transport";
  return null;
}
const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const COL: Record<string, keyof StaffImportRow> = {
  fullname: "fullName", name: "fullName", staffname: "fullName", teachername: "fullName",
  role: "role", designation: "role", post: "role",
  employeecode: "employeeCode", empcode: "employeeCode", code: "employeeCode", employeeid: "employeeCode", staffid: "employeeCode",
  email: "email", emailaddress: "email", mail: "email",
  phone: "phone", mobile: "phone", phonenumber: "phone", mobileno: "phone", contact: "phone",
};

function check(cells: string[][]): { rows: Checked[]; problem: string | null } {
  if (!cells.length) return { rows: [], problem: "The file is empty." };
  const head = cells[0].map((h) => COL[norm(h ?? "")]);
  if (!head.includes("fullName")) return { rows: [], problem: "The first row should be the headings, including Full name. Download the template to see them." };
  const seen = new Set<string>();
  const rows = cells.slice(1).map((c, i): Checked => {
    const get = (k: keyof StaffImportRow) => { const idx = head.indexOf(k); return idx >= 0 ? String(c[idx] ?? "").trim() : ""; };
    const errors: string[] = [];
    const fullName = get("fullName");
    if (!fullName) errors.push("Name is missing");
    const roleText = get("role");
    const role = roleOf(roleText);
    if (!role) errors.push(`Role "${roleText}" is not one of Teacher, Class teacher, Principal, Office, Transport`);
    const email = get("email").toLowerCase();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push("Email does not look right");
    const code = get("employeeCode");
    const key = code ? `c:${code.toUpperCase()}` : email ? `e:${email}` : "";
    if (key) { if (seen.has(key)) errors.push("Appears twice in the file"); seen.add(key); }
    return { line: i + 2, row: { fullName, role: role ?? "subject_teacher", employeeCode: code, email, phone: get("phone") }, errors };
  });
  return { rows, problem: rows.length ? null : "No staff rows were found under the headings." };
}

function downloadTemplate() {
  const blob = new Blob(["﻿" + HEADERS.join(",") + "\r\nAnita Sharma,Teacher,T-014,anita@gmail.com,9876543210\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "staff-template.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Manage School › Teachers: add or update many staff from one Excel or CSV file.
export function StaffImport() {
  const router = useRouter();
  const inputId = useId();
  const [rows, setRows] = useState<Checked[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function choose(file: File | undefined) {
    setRows(null); setProblem(null); setDone(null);
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setProblem("This file is too big. Please import at most 1000 staff at a time."); return; }
    try {
      const res = check(await readSpreadsheet(file, parseCsv));
      if (res.problem) { setProblem(res.problem); return; }
      setRows(res.rows);
    } catch (e) {
      setProblem(e instanceof SpreadsheetError ? e.message : "We could not read this file. Please check it is an Excel or CSV file.");
    }
  }
  const good = rows?.filter((r) => !r.errors.length) ?? [];
  const bad = rows ? rows.length - good.length : 0;
  function run() {
    setProblem(null);
    start(async () => {
      const res = await importStaff(good.map((r) => r.row));
      if (!res.ok) { setProblem(res.error); return; }
      setRows(null);
      setDone([res.added && `${res.added} added`, res.updated && `${res.updated} updated`].filter(Boolean).join(", ") || "Nothing changed");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title="Upload a list of staff" />
      <CardBody>
        <ol className="list-decimal space-y-1 pl-5 text-[14px] text-ink-900">
          <li>Use the template, or any sheet with the headings <span className="font-medium">{HEADERS.join(", ")}</span>.{" "}
            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 font-medium text-[#0F6CBD] hover:underline"><ExcelIcon size={15} />Download template</button>
          </li>
          <li>Write the role in plain words: Teacher, Class teacher, Principal, Office, Driver or Conductor.</li>
          <li>Staff already on file (same employee code, or same email) are updated; blank cells never wipe what is there.</li>
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor={inputId} className="inline-flex h-9 cursor-pointer items-center rounded-sm border border-hair bg-surface px-3 text-[14px] font-medium text-ink-900 hover:bg-panel">Choose an Excel or CSV file</label>
          <input id={inputId} type="file" accept=".xlsx,.csv,text/csv,.xls" className="sr-only" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
          {rows && <span className="text-[13px] text-ink-700">{good.length} ready{bad ? `, ${bad} with problems (not imported)` : ""}</span>}
        </div>
        {problem && <p role="alert" className="mt-3 text-[13px] font-medium text-down">{problem}</p>}
        {done && <p role="status" className="mt-3 text-[13px] font-medium text-up">Upload finished: {done}.</p>}
        {rows && (
          <>
            <ul className="mt-3 max-h-72 divide-y divide-hair overflow-y-auto rounded-sm border border-hair">
              {[...rows].sort((a, b) => Number(!a.errors.length) - Number(!b.errors.length) || a.line - b.line).slice(0, 200).map((r) => (
                <li key={r.line} className="flex flex-wrap gap-x-3 px-3 py-1.5 text-[13px]">
                  <span className="w-12 text-ink-500">Row {r.line}</span>
                  <span className="min-w-[160px] flex-1 text-ink-900">{r.row.fullName || "(no name)"}</span>
                  {r.errors.length ? <span className="text-down">{r.errors.join("; ")}</span> : <span className="text-ink-500">{[r.row.employeeCode, r.row.email].filter(Boolean).join(" · ")}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-3"><Button onClick={run} disabled={pending || !good.length}>{pending ? "Importing…" : `Import ${good.length} staff`}</Button></div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
