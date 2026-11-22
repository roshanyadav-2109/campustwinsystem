"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { checkSubmission } from "@/app/dashboard/homework/actions";
import { SubmissionStatus, OutLink, fmtStamp, fmtMarks, submissionState } from "@/components/homework/shared";

export type RosterEntry = {
  studentId: number;
  name: string;
  roll: number | null;
  submission: {
    id: number;
    note: string | null;
    link_url: string | null;
    submitted_at: string;
    is_late: boolean;
    marks: number | null;
    remark: string | null;
    checked_at: string | null;
  } | null;
};

// The section's roll for one piece of homework: who has handed it in, what
// they sent, and (for the teacher) marks and a remark, saved one student at a time.
export function SubmissionRoster({ entries, maxMarks, canCheck }: { entries: RosterEntry[]; maxMarks: number | null; canCheck: boolean }) {
  return (
    <ul className="divide-y divide-hair">
      {entries.map((e) => (
        <RosterRow key={e.studentId} entry={e} maxMarks={maxMarks} canCheck={canCheck} />
      ))}
    </ul>
  );
}

function RosterRow({ entry, maxMarks, canCheck }: { entry: RosterEntry; maxMarks: number | null; canCheck: boolean }) {
  const sub = entry.submission;
  const [marks, setMarks] = useState(sub?.marks != null ? String(sub.marks) : "");
  const [remark, setRemark] = useState(sub?.remark ?? "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (!sub) return;
    setErr(null); setSaved(false);
    if (maxMarks !== null && marks.trim()) {
      const n = Number(marks);
      if (!Number.isFinite(n) || n < 0 || n > maxMarks) { setErr(`Marks must be between 0 and ${fmtMarks(maxMarks)}.`); return; }
    }
    start(async () => {
      const res = await checkSubmission({ submissionId: sub.id, marks: maxMarks !== null && marks.trim() ? marks.trim() : null, remark });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
      else setErr(res.error);
    });
  }

  return (
    <li className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-7 shrink-0 text-[13px] tabular text-ink-500">{entry.roll ?? ""}</span>
          <span className="text-[14px] font-medium text-ink-900">{entry.name}</span>
          <SubmissionStatus state={submissionState(sub)} />
          {sub?.checked_at && sub.is_late && <span className="text-[12px] font-medium text-watch">Handed in late</span>}
        </div>
        {sub && (
          <div className="mt-1.5 space-y-1 pl-9">
            <div className="text-[12px] text-ink-500">Submitted {fmtStamp(sub.submitted_at)}</div>
            {sub.note && <p className="whitespace-pre-line break-words text-[13px] text-ink-700">{sub.note}</p>}
            <OutLink href={sub.link_url}>Open the student&apos;s link</OutLink>
          </div>
        )}
      </div>

      {sub && canCheck && (
        <div className="pl-9 lg:pl-0">
          <div className="flex flex-wrap items-center gap-2">
            {maxMarks !== null && (
              <div className="flex items-center gap-1.5">
                <Input aria-label={`Marks for ${entry.name}`} type="number" inputMode="decimal" min={0} max={maxMarks} step="any"
                  value={marks} onChange={(e) => setMarks(e.target.value)} className="h-9 w-20" />
                <span className="text-[13px] tabular text-ink-500">/ {fmtMarks(maxMarks)}</span>
              </div>
            )}
            <Input aria-label={`Remark for ${entry.name}`} placeholder="Remark" maxLength={500}
              value={remark} onChange={(e) => setRemark(e.target.value)} className="h-9 min-w-[160px] flex-1" />
            <Button size="sm" variant="subtle" disabled={pending} onClick={save} className="h-9">
              {pending ? "Saving" : sub.checked_at ? "Update" : "Save"}
            </Button>
          </div>
          {saved && <p className="mt-1 text-[12px] font-medium text-up">Saved</p>}
          {err && <p className="mt-1 text-[12px] font-medium text-down" role="alert">{err}</p>}
        </div>
      )}

      {sub && !canCheck && sub.checked_at && (
        <div className="pl-9 text-[13px] text-ink-700 lg:pl-0">
          {sub.marks !== null && maxMarks !== null && (
            <span className="font-semibold tabular text-ink-900">{fmtMarks(sub.marks)} / {fmtMarks(maxMarks)}</span>
          )}
          {sub.remark && <p className="whitespace-pre-line break-words">{sub.remark}</p>}
        </div>
      )}
    </li>
  );
}
