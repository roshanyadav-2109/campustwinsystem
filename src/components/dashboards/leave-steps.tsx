"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { advanceStaffLeave } from "@/app/dashboard/hr/actions";

export type LeaveStep = { id: number; staff_name: string; from_date: string; to_date: string; days: number; reason: string | null; step: string; leave_type: string | null; balance_left?: number | null; lessons?: number; covered?: number };
const dmy = (d: string) => d.split("-").reverse().join("/");

// Teachers' leave waiting for the Head of Department or the Dean (then the registrar or office decides).
export function LeaveSteps({ rows }: { rows: LeaveStep[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!rows.length) return null;
  const act = (id: number, ok: boolean) => start(async () => { const r = await advanceStaffLeave(id, ok, note[id] ?? ""); setMsg(r.ok ? (ok ? "Recommended and passed on." : "Refused.") : r.error); router.refresh(); });
  return (
    <div className="mt-3 rounded-sm border border-hair bg-white p-3 text-[13px]">
      <div className="font-semibold text-ink-900">Staff leave waiting for you ({rows.length})</div>
      <ul className="mt-1 space-y-1">{rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2"><b>{r.staff_name}</b> {r.leave_type ?? "Leave"}, {dmy(r.from_date)}{r.to_date !== r.from_date ? ` to ${dmy(r.to_date)}` : ""} ({Number(r.days)} day{Number(r.days) === 1 ? "" : "s"}){r.reason ? `: ${r.reason}` : ""}
          <span className="text-[12px] text-ink-500">{r.balance_left != null ? `${Number(r.balance_left)} day${Number(r.balance_left) === 1 ? "" : "s"} left after this` : ""}{r.lessons ? `${r.balance_left != null ? "; " : ""}${r.lessons} lesson${r.lessons === 1 ? "" : "s"} in these days, ${r.covered ?? 0} with a substitute` : ""}</span>
          <input className="h-8 w-48 rounded-sm border border-hair px-2 text-[12px]" aria-label={`Note on ${r.staff_name}'s leave`} placeholder="Note (needed to refuse)" value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
          <Button size="sm" disabled={pending} onClick={() => act(r.id, true)}>Recommend</Button>
          <Button size="sm" variant="ghost" disabled={pending || !(note[r.id] ?? "").trim()} onClick={() => act(r.id, false)}>Refuse</Button></li>))}</ul>
      {msg && <p className="mt-1 text-[12px] text-ink-700">{msg}</p>}
    </div>
  );
}
