"use client";
import { useState, useTransition } from "react";
import { setOwnTeacherEvaluation } from "@/app/dashboard/exam-cell/actions";

// Small colleges often have one teacher per subject: let the exam cell allow them to value their own students' coded scripts.
export function OwnTeacherEvaluation({ on, canEdit }: { on: boolean; canEdit: boolean }) {
  const [v, setV] = useState(on);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="rounded-md border border-hair bg-white p-4 text-[13px]">
      <div className="text-[14px] font-semibold">Coded valuation</div>
      <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={v} disabled={pending || !canEdit}
        onChange={(e) => { const next = e.target.checked; setV(next); start(async () => { const r = await setOwnTeacherEvaluation(next); setMsg(r.ok ? r.message ?? "" : r.error); if (!r.ok) setV(!next); }); }} />
        Teachers may value coded scripts of students they teach (for subjects with one teacher)</label>
      {msg && <p className="mt-1 text-[12px] text-ink-500">{msg}</p>}
    </section>
  );
}
