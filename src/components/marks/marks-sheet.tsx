"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { downloadXlsx } from "@/lib/xlsx";
import { readSpreadsheet, SpreadsheetError } from "@/lib/xlsx-read";
import { parseCsv } from "@/app/dashboard/students/manage/rules";
import { marksSheet, importMarksSheet, type SheetProblem } from "@/app/dashboard/marks/sheet-actions";

// Marks for a whole section and term in one Excel sheet: download, fill in, upload.
export function MarksSheet({ sectionId, sectionLabel, yearId }: { sectionId: number; sectionLabel: string; yearId: number }) {
  const [term, setTerm] = useState(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [problems, setProblems] = useState<SheetProblem[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card className="mt-4">
      <CardHeader title="Whole section in Excel" action={<span className="text-[12px] text-ink-500">Every subject&apos;s exams for a term in one sheet</span>} />
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select className="h-9 w-28 text-[13px]" aria-label="Term for the Excel sheet" value={term} onChange={(e) => setTerm(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Term {n}</option>)}
          </Select>
          <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => {
            setMsg(null); setProblems([]);
            const r = await marksSheet({ sectionId, yearId, term });
            if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
            downloadXlsx(`Marks ${sectionLabel} term ${term}`, r.headers, r.rows, "Marks");
          })}>Download sheet</Button>
          <label className="inline-flex h-8 cursor-pointer items-center rounded-sm border border-hair bg-panel px-3 text-[13px] text-ink-900 hover:bg-gold-100">
            Upload filled sheet
            <input type="file" className="sr-only" aria-label="Filled marks sheet" accept=".xlsx,.csv" disabled={pending} onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              start(async () => {
                setMsg(null); setProblems([]);
                let rows: string[][];
                try { rows = await readSpreadsheet(f, parseCsv); } catch (err) { setMsg({ ok: false, text: err instanceof SpreadsheetError ? err.message : "Could not read the file." }); return; }
                const r = await importMarksSheet({ sectionId, yearId, term, rows });
                if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
                if (r.problems.length) { setProblems(r.problems); setMsg({ ok: false, text: `Nothing was saved. Fix these ${r.problems.length} cells and upload again.` }); return; }
                setMsg({ ok: r.refused.length === 0, text: `${r.saved} marks saved.${r.refused.length ? ` Not saved: ${r.refused.join("; ")}.` : ""}` });
                router.refresh();
              });
            }} />
          </label>
          <span className="text-[12px] text-ink-500">Write a number, AB for absent, EX for exempt. Empty cells are left as they are.</span>
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
        {problems.length > 0 && (
          <ul className="max-h-48 overflow-auto rounded-sm border border-hair text-[12px]">
            {problems.map((p, i) => <li key={i} className="border-b border-hair px-3 py-1 last:border-b-0">Row {p.row}, {p.column}: {p.problem}</li>)}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
