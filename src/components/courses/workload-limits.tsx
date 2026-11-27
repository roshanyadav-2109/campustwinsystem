"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { saveWorkloadLimits } from "@/app/dashboard/workload/actions";

export function WorkloadLimits({ min, max }: { min: number; max: number }) {
  const [lo, setLo] = useState(String(min));
  const [hi, setHi] = useState(String(max));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[12px] text-ink-700">Fewest hours a week<Input className="mt-0.5 h-8 w-20" value={lo} onChange={(e) => setLo(e.target.value)} /></label>
      <label className="text-[12px] text-ink-700">Most hours a week<Input className="mt-0.5 h-8 w-20" value={hi} onChange={(e) => setHi(e.target.value)} /></label>
      <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const r = await saveWorkloadLimits(lo, hi); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>Save limits</Button>
      {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[12px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
    </div>
  );
}
