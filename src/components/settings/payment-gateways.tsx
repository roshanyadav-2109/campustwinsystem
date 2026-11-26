"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { GATEWAY_CHOICES, CONNECTED } from "@/core/payments/choices";
import { addGateway, saveGatewayKeys, setActiveGateway, resolvePayment } from "@/app/dashboard/settings/payments/actions";

export type GatewayRow = { id: number; provider: string; label: string | null; mode: "live" | "test"; active: boolean; hasKeys: boolean; merchantId: string; updated_at: string };
const name = (id: string) => GATEWAY_CHOICES.find((g) => g.id === id)?.label ?? id;

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}

function GatewayCard({ g }: { g: GatewayRow }) {
  const uid = useId();
  const [keys, setKeys] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ready = CONNECTED.has(g.provider);
  return (
    <div className="rounded-md border border-hair p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-medium text-ink-900">{g.label || name(g.provider)}{g.mode === "test" && <span className="ml-2 text-[12px] font-normal text-gold-700">test mode</span>}</p>
        {g.active ? <span className="text-[12px] font-medium text-up">On for parents</span> : <span className="text-[12px] text-ink-500">Off</span>}
        <span className="flex-1" />
        {g.active
          ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await setActiveGateway(null); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Switch off</Button>
          : <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await setActiveGateway(g.id); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Use for parents</Button>}
      </div>
      {!ready && <p className="mt-1 text-[12px] text-ink-500">CampusTwin connects {name(g.provider)} for you. Save your merchant keys here; we will tell you when it is ready.</p>}
      {g.provider !== "test" && (
        <div className="mt-2 space-y-2">
          <Field label={g.hasKeys ? "Keys (saved; enter new ones to replace them)" : "Keys from your gateway"} htmlFor={`${uid}-k`} hint="As JSON, for example {&quot;key_id&quot;: &quot;...&quot;, &quot;key_secret&quot;: &quot;...&quot;}. Stored securely and never shown again.">
            <Textarea id={`${uid}-k`} rows={2} value={keys} autoComplete="off" spellCheck={false} onChange={(e) => setKeys(e.target.value)} />
          </Field>
          <Button size="sm" variant="subtle" disabled={pending || !keys.trim()} onClick={() => start(async () => { const r = await saveGatewayKeys(g.id, keys); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) setKeys(""); router.refresh(); })}>Save keys</Button>
        </div>
      )}
      <div className="mt-2"><Msg m={msg} /></div>
    </div>
  );
}

export function PaymentGateways({ gateways }: { gateways: GatewayRow[] }) {
  const uid = useId();
  const [provider, setProvider] = useState(gateways.length ? "razorpay" : "test");
  const [mode, setMode] = useState<"live" | "test">("live");
  const [label, setLabel] = useState("");
  const [merchant, setMerchant] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card>
      <CardHeader title="Your gateways" action={<span className="text-[12px] text-ink-500">One is used for parents at a time</span>} />
      <CardBody className="space-y-3">
        {gateways.length === 0 && <p className="text-[13px] text-ink-700">No gateway yet. Start with the test gateway to try online payment end to end without real money.</p>}
        {gateways.map((g) => <GatewayCard key={g.id} g={g} />)}
        <div className="grid gap-3 border-t border-hair pt-3 sm:grid-cols-4">
          <Field label="Add a gateway" htmlFor={`${uid}-p`}>
            <Select id={`${uid}-p`} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {GATEWAY_CHOICES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </Select>
          </Field>
          {provider !== "test" && (
            <Field label="Mode" htmlFor={`${uid}-m`}>
              <Select id={`${uid}-m`} value={mode} onChange={(e) => setMode(e.target.value as "live" | "test")}><option value="live">Live</option><option value="test">Gateway&apos;s test mode</option></Select>
            </Field>
          )}
          {provider !== "test" && <Field label="Merchant id (optional)" htmlFor={`${uid}-id`}><Input id={`${uid}-id`} value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field>}
          <Field label="Name (optional)" htmlFor={`${uid}-l`}><Input id={`${uid}-l`} value={label} placeholder="For example: School fees account" onChange={(e) => setLabel(e.target.value)} /></Field>
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={pending} onClick={() => start(async () => { const r = await addGateway({ provider, mode, label, merchantId: merchant }); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Add gateway</Button>
          <Msg m={msg} />
        </div>
      </CardBody>
    </Card>
  );
}

// The office notes what it did about a payment that needed checking.
export function ResolvePayment({ orderId }: { orderId: number }) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open) return <Button size="sm" variant="ghost" className="ml-2" onClick={() => setOpen(true)}>Resolve</Button>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Input className="h-8 w-80 text-[13px]" aria-label="What was done" placeholder="For example: refunded by bank transfer on 2 Dec" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending || !note.trim()} onClick={() => start(async () => { const r = await resolvePayment(orderId, note); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Save</Button>
      <Msg m={msg} />
    </div>
  );
}
