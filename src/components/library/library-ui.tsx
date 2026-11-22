"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ExcelIcon } from "@/components/icons";
import { downloadXlsx } from "@/lib/xlsx";
import { markFinePaid, returnBook, saveSettings } from "@/app/dashboard/library/actions";
import { fmtDay, fmtMoney, todayIST, type LibrarySettings, type Loan } from "./shared";

// "Return" on a book that is out. The fine shown is the server's figure as of
// today; the server works it out again when the return is saved.
export function ReturnControls({ issueId, daysLate, fine }: { issueId: number; daysLate: number; fine: number }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(paidNow: boolean) {
    setProblem(null);
    start(async () => {
      const res = await returnBook(issueId, paidNow); if (res.ok) router.refresh();
      if (!res.ok) setProblem(res.error);
      setAsking(false);
    });
  }

  if (problem) return <span role="alert" className="text-[13px] font-medium text-down">{problem}</span>;

  if (asking) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <span className="text-[13px] text-ink-900">
          Fine <span className="font-semibold">{fmtMoney(fine)}</span> for {daysLate} {daysLate === 1 ? "day" : "days"} late
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="sm" disabled={pending} onClick={() => run(true)}>Return, fine paid</Button>
          <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(false)}>Return, fine due</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAsking(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <Button size="sm" variant="subtle" disabled={pending} onClick={() => (fine > 0 ? setAsking(true) : run(false))}>
      {pending ? "Saving…" : "Return"}
    </Button>
  );
}

export function FinePaidButton({ issueId }: { issueId: number }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (problem) return <span role="alert" className="text-[13px] font-medium text-down">{problem}</span>;
  return (
    <Button size="sm" variant="subtle" disabled={pending}
      onClick={() => start(async () => { const res = await markFinePaid(issueId); if (res.ok) router.refresh(); if (!res.ok) setProblem(res.error); })}>
      {pending ? "Saving…" : "Mark fine paid"}
    </Button>
  );
}

export function OverdueDownload({ loans }: { loans: Loan[] }) {
  function download() {
    downloadXlsx(
      `overdue-books-${todayIST()}`,
      ["Member", "Type", "Admission no", "Class", "Accession no", "Book", "Issued on", "Due on", "Days late", "Fine so far (Rs)"],
      loans.map((l) => [
        l.member_name, l.member_kind === "student" ? "Student" : "Staff", l.admission_no ?? "", l.class_section ?? "",
        l.accession_no, l.title, fmtDay(l.issued_on), fmtDay(l.due_on), l.days_late, l.fine,
      ]),
      "Overdue books",
    );
  }
  return (
    <Button size="sm" variant="subtle" onClick={download} disabled={!loans.length}>
      <ExcelIcon size={15} />Download Excel
    </Button>
  );
}

export function SettingsForm({ settings }: { settings: LibrarySettings }) {
  const router = useRouter();
  const [f, setF] = useState({
    loanDaysStudent: String(settings.loan_days_student),
    loanDaysStaff: String(settings.loan_days_staff),
    maxBooksStudent: String(settings.max_books_student),
    maxBooksStaff: String(settings.max_books_staff),
    finePerDay: String(settings.fine_per_day),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setSaved(false); setF((p) => ({ ...p, [k]: e.target.value })); };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setSaved(false);
    start(async () => {
      const res = await saveSettings({
        loanDaysStudent: Number(f.loanDaysStudent),
        loanDaysStaff: Number(f.loanDaysStaff),
        maxBooksStudent: Number(f.maxBooksStudent),
        maxBooksStaff: Number(f.maxBooksStaff),
        finePerDay: Number(f.finePerDay),
      }); if (res.ok) router.refresh();
      if (res.ok) setSaved(true); else setProblem(res.error);
    });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Library rules" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loan period for students (days)">
              <Input type="number" min={1} max={365} step={1} value={f.loanDaysStudent} onChange={set("loanDaysStudent")} required />
            </Field>
            <Field label="Loan period for staff (days)">
              <Input type="number" min={1} max={365} step={1} value={f.loanDaysStaff} onChange={set("loanDaysStaff")} required />
            </Field>
            <Field label="Books a student may hold">
              <Input type="number" min={0} max={50} step={1} value={f.maxBooksStudent} onChange={set("maxBooksStudent")} required />
            </Field>
            <Field label="Books a staff member may hold">
              <Input type="number" min={0} max={50} step={1} value={f.maxBooksStaff} onChange={set("maxBooksStaff")} required />
            </Field>
            <Field label="Fine per day late (₹)" hint="Applies to books returned from now on. Fines already recorded do not change.">
              <Input type="number" min={0} max={1000} step={0.5} value={f.finePerDay} onChange={set("finePerDay")} required />
            </Field>
          </div>
          {problem && <p role="alert" className="text-[13px] font-medium text-down">{problem}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            {saved && <span className="text-[13px] font-medium text-up">Saved</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
