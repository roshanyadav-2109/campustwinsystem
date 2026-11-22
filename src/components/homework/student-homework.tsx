"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { submitHomework } from "@/app/dashboard/homework/actions";
import { SubmissionStatus, OutLink, fmtDay, fmtStamp, fmtMarks, submissionState } from "@/components/homework/shared";

export type StudentHomeworkItem = {
  id: number;
  subject: string;
  title: string;
  instructions: string;
  dueDate: string;
  teacher: string | null;
  linkUrl: string | null;
  maxMarks: number | null;
  overdue: boolean;
  submission: {
    note: string | null;
    link_url: string | null;
    submitted_at: string;
    is_late: boolean;
    marks: number | null;
    remark: string | null;
    checked_at: string | null;
  } | null;
};

const NOTE_MAX = 1000;
const LINK_MAX = 500;

// One piece of homework as the student (or their guardian) sees it, with the
// form to mark it as done. It can be changed until the teacher has checked it.
export function StudentHomeworkCard({ item, studentId }: { item: StudentHomeworkItem; studentId: number }) {
  const sub = item.submission;
  const checked = !!sub?.checked_at;
  const [open, setOpen] = useState(!sub);
  const [note, setNote] = useState(sub?.note ?? "");
  const [link, setLink] = useState(sub?.link_url ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    const l = link.trim();
    if (l && (!l.startsWith("https://") || /\s/.test(l))) { setErr("The link must start with https://"); return; }
    start(async () => {
      const res = await submitHomework({ homeworkId: item.id, studentId, note: note.trim() || null, linkUrl: l || null });
      if (res.ok) setOpen(false);
      else setErr(res.error);
    });
  }

  return (
    <li className="rounded-md border border-hair bg-surface">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="t-label">{item.subject}</span>
          <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
            <span className="tabular">Due {fmtDay(item.dueDate)}</span>
            {item.overdue && <span className="font-semibold text-down">Overdue</span>}
            {sub && <SubmissionStatus state={submissionState(sub)} />}
            {checked && sub?.is_late && <span className="text-[12px] font-medium text-watch">Handed in late</span>}
          </span>
        </div>
        <h3 className="mt-1 text-[15px] font-semibold text-ink-900">{item.title}</h3>
        {item.teacher && <div className="text-[13px] text-ink-500">Set by {item.teacher}</div>}
        {item.instructions && <p className="mt-2 whitespace-pre-line break-words text-[14px] leading-relaxed text-ink-700">{item.instructions}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <OutLink href={item.linkUrl}>Open worksheet</OutLink>
          {item.maxMarks !== null && <span className="text-[13px] text-ink-500">Maximum marks {fmtMarks(item.maxMarks)}</span>}
        </div>
      </div>

      {checked && sub && (
        <div className="border-t border-hair bg-[#fafafa] px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[13px] font-semibold text-ink-900">Checked by your teacher</span>
            {sub.marks !== null && (
              <span className="text-[15px] font-bold tabular text-ink-900">
                {fmtMarks(sub.marks)}{item.maxMarks !== null ? ` / ${fmtMarks(item.maxMarks)}` : ""}
              </span>
            )}
          </div>
          {sub.remark && <p className="mt-1 whitespace-pre-line break-words text-[14px] text-ink-700">{sub.remark}</p>}
        </div>
      )}

      {sub && !open && (
        <div className="border-t border-hair px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="text-[12px] text-ink-500">Marked as done on {fmtStamp(sub.submitted_at)}</div>
              {sub.note && <p className="whitespace-pre-line break-words text-[13px] text-ink-700">{sub.note}</p>}
              <OutLink href={sub.link_url}>Open submitted link</OutLink>
            </div>
            {!checked && <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>Change</Button>}
          </div>
        </div>
      )}

      {!checked && open && (
        <div className="space-y-3 border-t border-hair px-4 py-3">
          <Field label="Note for the teacher" htmlFor={`hw-note-${item.id}`} hint="Optional">
            <Textarea id={`hw-note-${item.id}`} rows={2} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="Link to your work" htmlFor={`hw-link-${item.id}`} hint="Optional. Must start with https://">
            <Input id={`hw-link-${item.id}`} type="url" inputMode="url" placeholder="https://" value={link} maxLength={LINK_MAX} onChange={(e) => setLink(e.target.value)} />
          </Field>
          {!sub && item.overdue && <p className="text-[13px] text-ink-500">The due date has passed, so this will be recorded as late.</p>}
          {err && <p className="text-[13px] font-medium text-down" role="alert">{err}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={pending}>{pending ? "Saving" : sub ? "Save changes" : "Mark as done"}</Button>
            {sub && <Button variant="ghost" disabled={pending} onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>}
          </div>
        </div>
      )}
    </li>
  );
}
