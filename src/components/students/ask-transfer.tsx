"use client";
import { useEffect, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { siblingCampuses, askTransfer } from "@/app/dashboard/students/[id]/photo-actions";

// At a campus of a university: ask central administration to move this student to another campus.
export function AskTransfer({ studentId }: { studentId: number }) {
  const [campuses, setCampuses] = useState<{ id: number; name: string }[]>([]);
  const [to, setTo] = useState(0);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { void siblingCampuses().then((c) => { setCampuses(c); setTo(c[0]?.id ?? 0); }); }, []);
  if (!campuses.length) return null;
  return (
    <Card>
      <CardHeader title="Transfer to another campus" />
      <CardBody className="flex flex-wrap items-end gap-2 text-[13px]">
        <label>Campus<Select className="mt-1 h-8" aria-label="Campus to transfer to" value={to} onChange={(e) => setTo(Number(e.target.value))}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
        <label>Reason<Input className="mt-1 h-8 w-64" aria-label="Reason for the transfer" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
        <Button size="sm" disabled={pending || !to} onClick={() => start(async () => { const r = await askTransfer(studentId, to, reason); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); })}>Ask for the transfer</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`w-full font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
