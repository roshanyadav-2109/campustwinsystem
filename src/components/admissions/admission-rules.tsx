"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { setAdmissionRules } from "@/app/dashboard/admissions/selection/actions";

export function AdmissionRules({ fee, offerDays, auto, canEdit }: { fee: number | null; offerDays: number; auto: boolean; canEdit: boolean }) {
  const [f, setF] = useState(fee == null ? "" : String(Number(fee)));
  const [d, setD] = useState(String(offerDays));
  const [a, setA] = useState(auto);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader title="Fee, offers and the waiting list" />
      <CardBody className="flex flex-wrap items-end gap-3 text-[13px]">
        <label>Application fee (Rs)<Input className="mt-1 h-8 w-28" inputMode="decimal" disabled={!canEdit} value={f} onChange={(e) => setF(e.target.value)} aria-label="Application fee" /></label>
        <label>Offer open for (days)<Input className="mt-1 h-8 w-20" inputMode="numeric" disabled={!canEdit} value={d} onChange={(e) => setD(e.target.value)} aria-label="Offer open for days" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={a} onChange={(e) => setA(e.target.checked)} />Offer free seats to the waiting list automatically</label>
        {canEdit && <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await setAdmissionRules(f, d, a); setMsg(r.ok ? r.message ?? "Saved." : r.error); })}>Save</Button>}
        {msg && <span className="text-[12px] text-ink-700">{msg}</span>}
        <p className="w-full text-[12px] text-ink-500">Families pay the fee online from their application link when online payment is switched on (Settings, Online payment).</p>
      </CardBody>
    </Card>
  );
}
