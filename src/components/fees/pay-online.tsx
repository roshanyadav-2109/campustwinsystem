"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startOnlinePayment } from "@/app/dashboard/fees/pay/actions";

// "Pay online" on a family's bill. The amount is the bill's balance.
export function PayOnline({ invoiceId, label }: { invoiceId: number; label: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={pending} onClick={() => start(async () => {
        setErr(null);
        const r = await startOnlinePayment(invoiceId);
        if (r.ok) window.location.assign(r.url); else setErr(r.error);
      })}>{pending ? "Opening…" : label}</Button>
      {err && <span role="alert" className="max-w-[220px] text-right text-[12px] text-down">{err}</span>}
    </div>
  );
}
