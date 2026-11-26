"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { downloadPdf, downloadPdfBook } from "@/lib/pdf";
import { reportCardPdf, type CardSnapshot } from "@/components/report-cards/pdf";
import { lockTerm, unlockTerm, publishCards, publishedCards, saveEntries, type EntryRow } from "@/app/dashboard/report-cards/actions";

export type AreaOpt = { id: number; name: string; grades: string[] };
export type DeskRow = {
  studentId: number; report: Record<string, unknown>;
  published: { id: number; at: string; changed: boolean } | null;
  grades: Record<number, string>; remark: string; resultText: string; present: string; working: string;
};

type Rep = { student: { name: string; roll_no: number | null; admission_no: string | null; enrolment?: string }; total: number | null; max: number | null; percent: number | null; grade: string | null; result: string | null; incomplete: boolean; attendance: { present: number; working: number; entered: boolean } | null; subjects: { subject: string; percent: number | null; grade: string | null; incomplete: boolean; passed: boolean | null }[] };
type Edit = { grades: Record<number, string>; remark: string; resultText: string; present: string; working: string };

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}
const fmt = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(1));
const cell = "h-8 text-[13px]";

export function ReportCardsDesk({ sectionId, term, termLocked, canUnlock, rows, areas, isFinal, verifyBase }: {
  sectionId: number; term: number; termLocked: boolean; canUnlock: boolean; rows: DeskRow[]; areas: AreaOpt[]; isFinal: boolean; verifyBase: string;
}) {
  const start0 = useMemo(() => Object.fromEntries(rows.map((r) => [r.studentId, { grades: { ...r.grades }, remark: r.remark, resultText: r.resultText, present: r.present, working: r.working }])) as Record<number, Edit>, [rows]);
  const [edits, setEdits] = useState<Record<number, Edit>>(start0);
  const [mode, setMode] = useState<"results" | "entry">("results");
  const [allWorking, setAllWorking] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const same = (a: Edit, b: Edit) => a.remark === b.remark && a.resultText === b.resultText && a.present === b.present && a.working === b.working
    && areas.every((x) => (a.grades[x.id] ?? "") === (b.grades[x.id] ?? ""));
  const changed = rows.filter((r) => !same(edits[r.studentId], start0[r.studentId]));
  const incomplete = rows.filter((r) => (r.report as Rep).incomplete);
  const unpublished = rows.filter((r) => !r.published && (r.report as Rep).result !== "no_marks");
  const readyNew = unpublished.filter((r) => !(r.report as Rep).incomplete);
  const stale = rows.filter((r) => r.published?.changed);
  const publishedCount = rows.filter((r) => r.published).length;
  const set = (sid: number, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [sid]: { ...e[sid], ...patch } }));
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." });
    setConfirmAll(false);
    router.refresh();
  });
  const save = () => run(() => saveEntries({
    term,
    rows: changed.map((r): EntryRow => {
      const e = edits[r.studentId];
      return { studentId: r.studentId, grades: areas.map((a) => ({ areaId: a.id, grade: e.grades[a.id] ?? "" })), remark: e.remark, resultText: e.resultText, present: e.present, working: e.working };
    }),
  }));
  const download = () => start(async () => {
    const r = await publishedCards(sectionId, term);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    if (!r.cards.length) { setMsg({ ok: false, text: "No published report cards yet." }); return; }
    await downloadPdfBook(r.cards.map((c) => reportCardPdf(c.snapshot as CardSnapshot, verifyBase + c.token)), `Report cards ${term === 0 ? "year-end" : `term ${term}`}`);
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-2.5">
        <div className="flex rounded-sm border border-hair p-0.5 text-[13px]" role="tablist">
          {(["results", "entry"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`rounded-sm px-2.5 py-1 ${mode === m ? "bg-panel font-medium text-ink-900" : "text-ink-500"}`}>{m === "results" ? "Results" : "Grades, remarks and attendance"}</button>
          ))}
        </div>
        <span className="text-[13px] text-ink-700">
          {rows.length} students · {incomplete.length ? <span className="text-down">{incomplete.length} with marks missing</span> : "all marks in"} · {publishedCount} published
          {stale.length > 0 && <span className="text-down"> · {stale.length} changed since publishing</span>}
        </span>
        <span className="flex-1" />
        {!isFinal && (termLocked
          ? (canUnlock && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unlockTerm(sectionId, term))}>Unlock marks</Button>)
          : <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => lockTerm(sectionId, term))}>Lock marks</Button>)}
        <Button size="sm" disabled={pending || !termLocked || readyNew.length === 0} title={termLocked ? "" : "Lock the marks first"}
          onClick={() => run(() => publishCards(sectionId, term, readyNew.map((r) => r.studentId)))}>
          {readyNew.length ? `Publish ${readyNew.length} ${readyNew.length === 1 ? "card" : "cards"}` : "Publish report cards"}</Button>
        {publishedCount > 0 && termLocked && (
          confirmAll
            ? <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => publishCards(sectionId, term, rows.filter((r) => !(r.report as Rep).incomplete).map((r) => r.studentId)))}>Replace all published cards</Button>
            : <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmAll(true)}>Publish again</Button>
        )}
        <Button size="sm" variant="subtle" disabled={pending || !publishedCount} onClick={download}>Download PDFs</Button>
      </div>
      {msg && <div className="px-4 py-2"><Msg m={msg} /></div>}
      {confirmAll && <p className="px-4 py-2 text-[12px] text-down">This replaces every published card in this section with a new copy (old printed copies will show as replaced). Parents are not told again.</p>}
      {!termLocked && <p className="px-4 py-2 text-[12px] text-ink-500">{isFinal ? "Lock every term's marks to publish the year-end result." : "Lock the marks when they are final. After that, marks and exams cannot change until the office unlocks."}</p>}
      {termLocked && unpublished.length > readyNew.length && <p className="px-4 py-2 text-[12px] text-ink-500">{unpublished.length - readyNew.length} students with marks missing are not published. Enter their marks (or mark them exempt), then publish.</p>}

      {mode === "results" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="bg-[#fafafa] text-left text-ink-500"><tr>
              <th className="px-4 py-2 font-medium">Roll</th><th className="px-4 py-2 font-medium">Student</th>
              <th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-right font-medium">%</th>
              <th className="px-4 py-2 font-medium">Grade</th><th className="px-4 py-2 font-medium">Result</th>
              <th className="px-4 py-2 font-medium">Attendance</th><th className="px-4 py-2 font-medium">Card</th>
            </tr></thead>
            <tbody>
              {rows.map((row) => {
                const r = row.report as Rep;
                const weak = r.subjects.filter((s) => s.passed === false).map((s) => s.subject);
                return (
                  <tr key={row.studentId} className="border-t border-hair align-top">
                    <td className="px-4 py-2 tabular">{r.student.roll_no ?? "-"}</td>
                    <td className="px-4 py-2">
                      <span className="font-medium text-ink-900">{r.student.name}</span>
                      {r.student.enrolment && r.student.enrolment !== "active" && <span className="ml-2 text-[11px] text-ink-500">({r.student.enrolment})</span>}
                      {r.incomplete && <span className="block text-[12px] text-down">Marks missing: {r.subjects.filter((s) => s.incomplete).map((s) => s.subject).join(", ") || "all"}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular">{r.max ? `${fmt(r.total)}/${fmt(r.max)}` : "-"}</td>
                    <td className="px-4 py-2 text-right tabular">{fmt(r.percent)}</td>
                    <td className="px-4 py-2">{r.grade ?? "-"}</td>
                    <td className="px-4 py-2">{r.result === "pass" ? "Pass" : r.result === "needs_improvement" ? <span className="text-down" title={weak.join(", ")}>Needs improvement{weak.length ? `: ${weak.join(", ")}` : ""}</span> : r.result === "no_marks" ? "No marks" : "-"}</td>
                    <td className="px-4 py-2 tabular">{r.attendance ? `${r.attendance.present}/${r.attendance.working}` : "-"}</td>
                    <td className="px-4 py-2">{row.published ? <span className={row.published.changed ? "text-down" : "text-up"}>{row.published.changed ? "Changed since published" : "Published"}</span> : <span className="text-ink-500">Not yet</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12px] text-ink-700">
            {areas.map((a) => (
              <label key={a.id} className="flex items-center gap-1">Set all {a.name} to
                <Select className="h-7 w-16 text-[12px]" aria-label={`Set all ${a.name}`} value="" onChange={(e) => { const g = e.target.value; setEdits((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { ...v, grades: { ...v.grades, [a.id]: g } }]))); }}>
                  <option value="">-</option>{a.grades.map((g) => <option key={g}>{g}</option>)}</Select>
              </label>
            ))}
            <label className="flex items-center gap-1">Working days for everyone
              <Input className="h-7 w-16 text-[12px]" aria-label="Working days for everyone" inputMode="numeric" value={allWorking} onChange={(e) => setAllWorking(e.target.value)} />
              <Button size="sm" variant="ghost" onClick={() => setEdits((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { ...v, working: allWorking }])))}>Apply</Button>
            </label>
            <span className="text-ink-500">Leave attendance empty to count it from the register (needs term dates).</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="bg-[#fafafa] text-left text-ink-500"><tr>
                <th className="px-3 py-2 font-medium">Student</th>
                {areas.map((a) => <th key={a.id} className="px-2 py-2 font-medium">{a.name}</th>)}
                <th className="px-2 py-2 font-medium">Present</th><th className="px-2 py-2 font-medium">Working</th>
                <th className="px-2 py-2 font-medium">Remark</th>{isFinal && <th className="px-2 py-2 font-medium">Result line</th>}
              </tr></thead>
              <tbody>
                {rows.map((row) => {
                  const e = edits[row.studentId]; const name = (row.report as Rep).student.name;
                  return (
                    <tr key={row.studentId} className="border-t border-hair">
                      <td className="px-3 py-1.5 font-medium text-ink-900">{name}</td>
                      {areas.map((a) => (
                        <td key={a.id} className="px-2 py-1.5">
                          <Select className={`${cell} w-16`} aria-label={`${name}: ${a.name}`} value={e.grades[a.id] ?? ""} onChange={(ev) => set(row.studentId, { grades: { ...e.grades, [a.id]: ev.target.value } })}>
                            <option value="">-</option>{a.grades.map((g) => <option key={g}>{g}</option>)}</Select>
                        </td>))}
                      <td className="px-2 py-1.5"><Input className={`${cell} w-16`} aria-label={`${name}: days present`} inputMode="numeric" value={e.present} onChange={(ev) => set(row.studentId, { present: ev.target.value })} /></td>
                      <td className="px-2 py-1.5"><Input className={`${cell} w-16`} aria-label={`${name}: working days`} inputMode="numeric" value={e.working} onChange={(ev) => set(row.studentId, { working: ev.target.value })} /></td>
                      <td className="px-2 py-1.5"><Input className={`${cell} min-w-[220px]`} aria-label={`${name}: remark`} value={e.remark} maxLength={500} onChange={(ev) => set(row.studentId, { remark: ev.target.value })} /></td>
                      {isFinal && <td className="px-2 py-1.5"><Input className={`${cell} min-w-[180px]`} aria-label={`${name}: result line`} placeholder="Promoted to ..." value={e.resultText} maxLength={120} onChange={(ev) => set(row.studentId, { resultText: ev.target.value })} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 border-t border-hair px-4 py-2.5">
            <Button disabled={pending || changed.length === 0} onClick={save}>{pending ? "Saving…" : changed.length ? `Save ${changed.length} ${changed.length === 1 ? "student" : "students"}` : "No changes"}</Button>
            {changed.length > 0 && <span className="text-[12px] text-ink-500">Unsaved changes stay here while you switch to Results.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function FamilyCards({ cards }: { cards: { id: number; snapshot: Record<string, unknown>; token: string; publishedAt: string }[] }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<number | null>(null);
  const base = `https://verify.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}/verify/`;
  return (
    <ul className="space-y-2">
      {cards.map((c) => {
        const s = c.snapshot as unknown as CardSnapshot;
        return (
          <li key={c.id} className="rounded-md border border-hair bg-white">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink-900">{s.student.name}: {s.term_name}</p>
                <p className="text-[12px] text-ink-500">{[s.class, s.year].filter(Boolean).join(", ")}
                  {s.percent != null && s.scheme.show_percent ? ` · ${fmt(s.percent)}%` : ""}{s.grade && s.scheme.show_grades ? ` · Grade ${s.grade}` : ""}
                  {" · "}published {c.publishedAt}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide" : "View"}</Button>
              <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { await downloadPdf(reportCardPdf(s, base + c.token)); })}>Download PDF</Button>
            </div>
            {open === c.id && (
              <div className="overflow-x-auto border-t border-hair px-4 py-3">
                <table className="w-full text-[13px]">
                  <thead className="text-left text-ink-500"><tr><th className="py-1 font-medium">Subject</th>
                    {s.scheme.show_marks && <th className="py-1 text-right font-medium">Marks</th>}
                    {s.scheme.show_percent && <th className="py-1 text-right font-medium">%</th>}
                    {s.scheme.show_grades && <th className="py-1 pl-3 font-medium">Grade</th>}</tr></thead>
                  <tbody>{s.subjects.map((x) => (
                    <tr key={x.subject} className="border-t border-hair"><td className="py-1">{x.subject}</td>
                      {s.scheme.show_marks && <td className="py-1 text-right tabular">{x.total == null ? "-" : `${fmt(x.total)}/${fmt(x.max)}`}</td>}
                      {s.scheme.show_percent && <td className="py-1 text-right tabular">{fmt(x.percent)}</td>}
                      {s.scheme.show_grades && <td className="py-1 pl-3">{x.grade ?? "-"}</td>}</tr>))}
                  </tbody>
                </table>
                {s.remark && <p className="mt-2 text-[13px] text-ink-700"><span className="text-ink-500">Remark: </span>{s.remark}</p>}
                {s.attendance && <p className="mt-1 text-[13px] text-ink-700"><span className="text-ink-500">Attendance: </span>{s.attendance.present} of {s.attendance.working} days</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
