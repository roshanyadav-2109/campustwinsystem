"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { downloadPdf, downloadPdfBook } from "@/lib/pdf";
import { reportCardPdf, type CardSnapshot } from "@/components/report-cards/pdf";
import { lockTerm, unlockTerm, publishCards, publishedCards, saveEntry } from "@/app/dashboard/report-cards/actions";

export type AreaOpt = { id: number; name: string; grades: string[] };
export type DeskRow = {
  studentId: number; report: Record<string, unknown>;
  published: { id: number; at: string } | null;
  grades: Record<number, string>; remark: string; resultText: string; present: string; working: string;
};

type Rep = { student: { name: string; roll_no: number | null; admission_no: string | null; enrolment?: string }; total: number | null; max: number | null; percent: number | null; grade: string | null; result: string | null; incomplete: boolean; attendance: { present: number; working: number; entered: boolean } | null; subjects: { subject: string; percent: number | null; grade: string | null; incomplete: boolean; passed: boolean | null }[] };

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}
const fmt = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(1));

function Entry({ row, term, areas, isFinal, onSaved }: { row: DeskRow; term: number; areas: AreaOpt[]; isFinal: boolean; onSaved: () => void }) {
  const [grades, setGrades] = useState<Record<number, string>>(row.grades);
  const [remark, setRemark] = useState(row.remark);
  const [resultText, setResultText] = useState(row.resultText);
  const [present, setPresent] = useState(row.present);
  const [working, setWorking] = useState(row.working);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const name = (row.report as Rep).student.name;
  return (
    <div className="grid gap-3 bg-[#fafafa] px-4 py-3 lg:grid-cols-[2fr_3fr]">
      <div className="space-y-2">
        {areas.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {areas.map((a) => (
              <label key={a.id} className="text-[12px] text-ink-700">{a.name}
                <Select className="mt-0.5 h-8 text-[13px]" aria-label={`${name}: ${a.name}`} value={grades[a.id] ?? ""} onChange={(e) => setGrades((g) => ({ ...g, [a.id]: e.target.value }))}>
                  <option value="">-</option>{a.grades.map((g) => <option key={g}>{g}</option>)}</Select>
              </label>))}
          </div>
        )}
        <div className="flex items-end gap-2 text-[12px] text-ink-700">
          <label>Days present<Input className="mt-0.5 h-8 w-20 text-[13px]" aria-label={`${name}: days present`} inputMode="numeric" value={present} onChange={(e) => setPresent(e.target.value)} /></label>
          <label>of working days<Input className="mt-0.5 h-8 w-20 text-[13px]" aria-label={`${name}: working days`} inputMode="numeric" value={working} onChange={(e) => setWorking(e.target.value)} /></label>
          <span className="pb-2 text-[11px] text-ink-500">Leave empty to count from attendance.</span>
        </div>
      </div>
      <div className="space-y-2">
        <label className="block text-[12px] text-ink-700">Class teacher&apos;s remark
          <Textarea className="mt-0.5 text-[13px]" rows={2} aria-label={`${name}: remark`} value={remark} onChange={(e) => setRemark(e.target.value)} /></label>
        {isFinal && (
          <label className="block text-[12px] text-ink-700">Result line (for example: Promoted to Class VII)
            <Input className="mt-0.5 h-8 text-[13px]" aria-label={`${name}: result line`} value={resultText} onChange={(e) => setResultText(e.target.value)} /></label>
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={pending} onClick={() => start(async () => {
            const r = await saveEntry({ studentId: row.studentId, term, grades: areas.map((a) => ({ areaId: a.id, grade: grades[a.id] ?? "" })), remark, resultText, present, working });
            setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
            if (r.ok) onSaved();
          })}>{pending ? "Saving…" : "Save"}</Button>
          <Msg m={msg} />
        </div>
      </div>
    </div>
  );
}

export function ReportCardsDesk({ sectionId, term, termLocked, canUnlock, rows, areas, isFinal, verifyBase }: {
  sectionId: number; term: number; termLocked: boolean; canUnlock: boolean; rows: DeskRow[]; areas: AreaOpt[]; isFinal: boolean; verifyBase: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const incomplete = rows.filter((r) => (r.report as Rep).incomplete).length;
  const publishedCount = rows.filter((r) => r.published).length;
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." });
    router.refresh();
  });
  const download = () => start(async () => {
    const r = await publishedCards(sectionId, term);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    if (!r.cards.length) { setMsg({ ok: false, text: "No published report cards yet." }); return; }
    await downloadPdfBook(r.cards.map((c) => reportCardPdf(c.snapshot as CardSnapshot, verifyBase + c.token)), `Report cards ${term === 0 ? "year-end" : `term ${term}`}`);
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-2.5">
        <span className="text-[13px] text-ink-700">
          {rows.length} students · {incomplete ? <span className="text-down">{incomplete} with marks missing</span> : "all marks in"} · {publishedCount} published
        </span>
        <span className="flex-1" />
        {!isFinal && (termLocked
          ? (canUnlock && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unlockTerm(sectionId, term))}>Unlock marks</Button>)
          : <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => lockTerm(sectionId, term))}>Lock marks</Button>)}
        <Button size="sm" disabled={pending || !termLocked} title={termLocked ? "" : "Lock the marks first"} onClick={() => run(() => publishCards(sectionId, term))}>
          {publishedCount ? "Publish again" : "Publish report cards"}</Button>
        <Button size="sm" variant="subtle" disabled={pending || !publishedCount} onClick={download}>Download PDFs</Button>
      </div>
      {msg && <div className="px-4 py-2"><Msg m={msg} /></div>}
      {!termLocked && <p className="px-4 py-2 text-[12px] text-ink-500">{isFinal ? "Lock every term's marks to publish the year-end result." : "Lock the marks when they are final. After that nobody can change them until the office unlocks."}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="bg-[#fafafa] text-left text-ink-500"><tr>
            <th className="px-4 py-2 font-medium">Roll</th><th className="px-4 py-2 font-medium">Student</th>
            <th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-right font-medium">%</th>
            <th className="px-4 py-2 font-medium">Grade</th><th className="px-4 py-2 font-medium">Result</th>
            <th className="px-4 py-2 font-medium">Attendance</th><th className="px-4 py-2 font-medium">Card</th><th />
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const r = row.report as Rep;
              const weak = r.subjects.filter((s) => s.passed === false).map((s) => s.subject);
              return (
                <FragmentRow key={row.studentId}>
                  <tr className="border-t border-hair align-top">
                    <td className="px-4 py-2 tabular">{r.student.roll_no ?? "-"}</td>
                    <td className="px-4 py-2">
                      <span className="font-medium text-ink-900">{r.student.name}</span>
                      {r.student.enrolment && r.student.enrolment !== "active" && <span className="ml-2 text-[11px] text-ink-500">({r.student.enrolment})</span>}
                      {r.incomplete && <span className="block text-[12px] text-down">Marks missing: {r.subjects.filter((s) => s.incomplete).map((s) => s.subject).join(", ") || "all"}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular">{r.max ? `${fmt(r.total)}/${fmt(r.max)}` : "-"}</td>
                    <td className="px-4 py-2 text-right tabular">{fmt(r.percent)}</td>
                    <td className="px-4 py-2">{r.grade ?? "-"}</td>
                    <td className="px-4 py-2">{r.result === "pass" ? "Pass" : r.result === "needs_improvement" ? <span className="text-down" title={weak.join(", ")}>Needs improvement</span> : r.result === "no_marks" ? "No marks" : "-"}</td>
                    <td className="px-4 py-2 tabular">{r.attendance ? `${r.attendance.present}/${r.attendance.working}` : "-"}</td>
                    <td className="px-4 py-2">{row.published ? <span className="text-up">Published</span> : <span className="text-ink-500">Not yet</span>}</td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(open === row.studentId ? null : row.studentId)}>{open === row.studentId ? "Close" : "Grades and remark"}</Button>
                    </td>
                  </tr>
                  {open === row.studentId && (
                    <tr><td colSpan={9} className="p-0"><Entry row={row} term={term} areas={areas} isFinal={isFinal} onSaved={() => router.refresh()} /></td></tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

export function FamilyCards({ cards }: { cards: { id: number; snapshot: Record<string, unknown>; token: string; publishedAt: string }[] }) {
  const [pending, start] = useTransition();
  const base = `https://verify.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}/verify/`;
  return (
    <ul className="space-y-2">
      {cards.map((c) => {
        const s = c.snapshot as unknown as CardSnapshot;
        return (
          <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-md border border-hair bg-white px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink-900">{s.student.name}: {s.term_name}</p>
              <p className="text-[12px] text-ink-500">{[s.class, s.year].filter(Boolean).join(", ")}
                {s.percent != null && s.scheme.show_percent ? ` · ${fmt(s.percent)}%` : ""}{s.grade && s.scheme.show_grades ? ` · Grade ${s.grade}` : ""}
                {" · "}published {c.publishedAt}</p>
            </div>
            <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { await downloadPdf(reportCardPdf(s, base + c.token)); })}>Download PDF</Button>
          </li>
        );
      })}
    </ul>
  );
}
