"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { saveChannel, saveChannelKeys, sendTestMessage, type Channel, type Provider } from "@/app/dashboard/settings/messages/actions";

export type ChannelState = {
  channel: Channel; provider: Provider; hasKeys: boolean; dailyLimit: number | null;
  config: { region?: string; from?: string; url?: string; method?: string; body?: string; headers?: Record<string, string>; content_type?: string };
};

const TITLE: Record<Channel, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
const PROVIDERS: Record<Channel, { value: Provider; label: string }[]> = {
  email: [
    { value: "off", label: "Off" },
    { value: "log", label: "Test mode (record only, nothing is sent)" },
    { value: "ses", label: "Amazon SES" },
  ],
  sms: [
    { value: "off", label: "Off" },
    { value: "log", label: "Test mode (record only, nothing is sent)" },
    { value: "http", label: "Your SMS provider (any provider with a web address)" },
  ],
  whatsapp: [
    { value: "off", label: "Off" },
    { value: "log", label: "Test mode (record only, nothing is sent)" },
    { value: "http", label: "Your WhatsApp provider (any provider with a web address)" },
  ],
};
const KEY_HINT: Record<Channel, string> = {
  email: '{"accessKeyId": "...", "secretAccessKey": "..."}',
  sms: '{"api_key": "..."}',
  whatsapp: '{"token": "..."}',
};

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}

function ChannelCard({ state }: { state: ChannelState }) {
  const uid = useId();
  const c = state.channel;
  const [provider, setProvider] = useState<Provider>(state.provider);
  const [region, setRegion] = useState(state.config.region ?? "ap-south-1");
  const [from, setFrom] = useState(state.config.from ?? "");
  const [url, setUrl] = useState(state.config.url ?? "");
  const [method, setMethod] = useState(state.config.method ?? "POST");
  const [headers, setHeaders] = useState(state.config.headers && Object.keys(state.config.headers).length ? JSON.stringify(state.config.headers) : "");
  const [body, setBody] = useState(state.config.body ?? '{"to": "{to}", "message": "{text}", "template_id": "{template_id}"}');
  const [contentType, setContentType] = useState<"json" | "form">(state.config.content_type === "form" ? "form" : "json");
  const [dailyLimit, setDailyLimit] = useState(state.dailyLimit == null ? "" : String(state.dailyLimit));
  const [keys, setKeys] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const needsKeys = provider === "ses" || provider === "http";

  return (
    <Card>
      <CardHeader title={TITLE[c]} action={<span className="text-[12px] text-ink-500">{state.provider === "off" ? "Off" : state.provider === "log" ? "Test mode" : "On"}</span>} />
      <CardBody className="space-y-3">
        <Field label="How messages go out" htmlFor={`${uid}-p`}>
          <Select id={`${uid}-p`} aria-label={`${TITLE[c]} provider`} value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            {PROVIDERS[c].map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        {provider === "ses" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SES region" htmlFor={`${uid}-r`} hint="For example ap-south-1 (Mumbai).">
              <Input id={`${uid}-r`} value={region} onChange={(e) => setRegion(e.target.value)} />
            </Field>
            <Field label="Send from" htmlFor={`${uid}-f`} hint="An address verified in your SES account.">
              <Input id={`${uid}-f`} value={from} placeholder="office@yourschool.in" onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
        )}
        {provider === "http" && (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-700">
              Copy these from your provider&apos;s instructions. In the address, headers and body you can use{" "}
              <code>{"{to}"}</code>, <code>{"{text}"}</code>, <code>{"{template_id}"}</code> and any name from your keys, such as <code>{"{api_key}"}</code>.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <Field label="Provider address" htmlFor={`${uid}-u`}>
                <Input id={`${uid}-u`} value={url} placeholder="https://api.provider.com/send" onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Field label="Method" htmlFor={`${uid}-m`}>
                <Select id={`${uid}-m`} value={method} onChange={(e) => setMethod(e.target.value)}><option>POST</option><option>GET</option></Select>
              </Field>
            </div>
            <Field label="Headers (optional)" htmlFor={`${uid}-h`} hint='For example {"Authorization": "Bearer {api_key}"}'>
              <Input id={`${uid}-h`} value={headers} onChange={(e) => setHeaders(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <Field label="Body" htmlFor={`${uid}-b`}>
                <Textarea id={`${uid}-b`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
              <Field label="Body format" htmlFor={`${uid}-t`}>
                <Select id={`${uid}-t`} value={contentType} onChange={(e) => setContentType(e.target.value as "json" | "form")}>
                  <option value="json">JSON</option><option value="form">Form fields</option>
                </Select>
              </Field>
            </div>
          </div>
        )}
        {provider !== "off" && (
          <Field label="Daily limit (optional)" htmlFor={`${uid}-l`} hint="Most messages this channel may send in a day. Empty means no limit.">
            <Input id={`${uid}-l`} inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
          </Field>
        )}
        <Button disabled={pending} onClick={() => start(async () => {
          const r = await saveChannel({ channel: c, provider, region, from, url, method, headers, body, contentType, dailyLimit });
          setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
        })}>{pending ? "Saving…" : `Save ${TITLE[c]}`}</Button>
        <Msg m={msg} />

        {needsKeys && (
          <div className="space-y-2 border-t border-hair pt-3">
            <Field label={state.hasKeys ? "Keys (saved; enter new ones to replace them)" : "Keys"} htmlFor={`${uid}-k`} hint={`Stored securely and never shown again. Format: ${KEY_HINT[c]}`}>
              <Textarea id={`${uid}-k`} rows={2} value={keys} autoComplete="off" spellCheck={false} onChange={(e) => setKeys(e.target.value)} />
            </Field>
            <Button variant="subtle" disabled={pending || !keys.trim()} onClick={() => start(async () => {
              const r = await saveChannelKeys(c, keys);
              setKeyMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
              if (r.ok) setKeys("");
            })}>Save keys</Button>
            <Msg m={keyMsg} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function MessageChannels({ channels, canEdit }: { channels: ChannelState[]; canEdit: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        {channels.map((s) => <ChannelCard key={s.channel} state={s} />)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="subtle" disabled={pending} onClick={() => start(async () => {
          const r = await sendTestMessage();
          setMsg(r.ok ? { ok: true, text: r.message ?? "Sent." } : { ok: false, text: r.error });
        })}>Send a test message to me</Button>
        <Msg m={msg} />
      </div>
    </div>
  );
}
