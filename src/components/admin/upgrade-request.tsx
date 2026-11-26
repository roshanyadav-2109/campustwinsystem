"use client";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { requestUpgrade } from "@/app/dashboard/settings/admin/actions";

export function UpgradeRequest({ plans, current, pending: alreadyPending }: { plans: { code: string; name: string }[]; current: string; pending: string | null }) {
  const id = useId();
  const others = plans.filter((p) => p.code !== current);
  const [plan, setPlan] = useState(others[0]?.code ?? "");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, start] = useTransition();
  if (alreadyPending) return <p className="text-[13px] text-ink-700">Your request to move to <span className="font-medium">{alreadyPending}</span> is with the Eternity team. Once approved, the new modules switch on by themselves.</p>;
  if (!others.length) return null;
  return (
    <div className="space-y-3">
      <Field label="Move to" htmlFor={`${id}-p`}>
        <Select id={`${id}-p`} value={plan} onChange={(e) => setPlan(e.target.value)}>
          {others.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Anything we should know (optional)" htmlFor={`${id}-n`}>
        <Textarea id={`${id}-n`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || !plan} onClick={() => start(async () => {
          const res = await requestUpgrade({ plan, note });
          setMsg(res.ok ? { text: "Request sent. The Eternity team will confirm, and the modules switch on as soon as it is approved.", ok: true } : { text: res.error, ok: false });
        })}>{busy ? "Sending…" : "Request this plan"}</Button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
    </div>
  );
}
