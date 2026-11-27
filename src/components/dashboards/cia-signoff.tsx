"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signCia } from "@/app/dashboard/exam-cell/actions";

export function CiaSignoff({ semesterId, rows }: { semesterId: number; rows: { section_id: number; section_label: string; subject_id: number; subject_name: string; signed: boolean }[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const waiting = rows.filter((r) => !r.signed);
  if (!rows.length) return null;
  return (
    <div className="mt-3 border-t border-hair pt-3">
      <div className="text-[13px] font-semibold">Internal marks to sign off ({waiting.length} of {rows.length})</div>
      <ul className="mt-1 space-y-1 text-[13px]">{rows.slice(0, 30).map((r) => (
        <li key={`${r.section_id}-${r.subject_id}`} className="flex flex-wrap items-center gap-2">{r.section_label}, {r.subject_name}
          {r.signed ? <span className="text-up">signed off</span> : <Button size="sm" variant="ghost" disabled={pending} aria-label={`Sign off ${r.section_label}, ${r.subject_name}`}
            onClick={() => start(async () => { const x = await signCia(semesterId, r.section_id, r.subject_id); setMsg(x.ok ? x.message ?? "" : x.error); router.refresh(); })}>Sign off</Button>}</li>))}</ul>
      {msg && <p className="text-[12px] text-ink-700">{msg}</p>}
    </div>
  );
}
