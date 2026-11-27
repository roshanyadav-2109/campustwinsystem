"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setNotifyGuardians } from "@/app/dashboard/settings/messages/parents-action";

// Colleges and universities: students are told first; parents only when the institution keeps them informed.
export function ParentsInformed({ on }: { on: boolean }) {
  const [v, setV] = useState(on);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <section className="rounded-md border border-hair bg-white p-4 text-[13px]">
      <div className="text-[14px] font-semibold">Students and parents</div>
      <p className="mt-1 text-ink-700">Notices, results and decisions go to students themselves.</p>
      <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={v} disabled={pending}
        onChange={(e) => { const next = e.target.checked; setV(next); start(async () => { const r = await setNotifyGuardians(next); setMsg(r); router.refresh(); }); }} />Keep parents informed too</label>
      {msg && <p className="mt-1 text-[12px] text-ink-500">{msg}</p>}
    </section>
  );
}
