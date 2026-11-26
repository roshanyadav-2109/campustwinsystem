"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { saveEventChannels, saveTemplate, type Channel } from "@/app/dashboard/settings/messages/actions";

export type EventRow = { key: string; label: string; urgent: boolean; on: Record<Channel, boolean> };
export type TemplateRow = { event: string; channel: Channel | "inbox"; subject: string | null; body: string; externalId: string | null };

const CH: { key: Channel; label: string }[] = [{ key: "sms", label: "SMS" }, { key: "whatsapp", label: "WhatsApp" }, { key: "email", label: "Email" }];

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}

// Which messages go out on which channel. Everyone always gets them in the app.
export function MessageEvents({ events, live }: { events: EventRow[]; live: Record<Channel, boolean> }) {
  const [rows, setRows] = useState(events);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const toggle = (k: string, c: Channel) => setRows((r) => r.map((e) => e.key === k ? { ...e, on: { ...e.on, [c]: !e.on[c] } } : e));
  return (
    <Card>
      <CardHeader title="Which messages go where" action={<span className="text-[12px] text-ink-500">The app always gets every message</span>} />
      <CardBody className="space-y-3 p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafafa] text-left text-ink-500">
              <tr>
                <th className="px-4 py-2 font-medium">Message</th>
                {CH.map((c) => <th key={c.key} className="px-4 py-2 text-center font-medium">{c.label}{!live[c.key] && <span className="block text-[11px] font-normal">(off)</span>}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.key} className="border-t border-hair">
                  <td className="px-4 py-2">{e.label}{e.urgent && <span className="ml-2 text-[12px] text-ink-500">sent at any hour</span>}</td>
                  {CH.map((c) => (
                    <td key={c.key} className="px-4 py-2 text-center">
                      <input type="checkbox" aria-label={`${e.label} by ${c.label}`} checked={e.on[c.key]} onChange={() => toggle(e.key, c.key)} className="h-4 w-4 accent-[#0F6CBD]" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await saveEventChannels(rows.flatMap((e) => CH.map((c) => ({ event: e.key, channel: c.key, enabled: e.on[c.key] }))));
            setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
          })}>{pending ? "Saving…" : "Save choices"}</Button>
          <span className="text-[12px] text-ink-500">SMS and WhatsApp that are not urgent wait until 7 am if they would go out between 9 pm and 7 am.</span>
          <Msg m={msg} />
        </div>
      </CardBody>
    </Card>
  );
}

// The institution's own wording per message and channel. SMS in India must
// match the template registered on DLT, with its template id.
export function MessageWording({ events, templates }: { events: EventRow[]; templates: TemplateRow[] }) {
  const uid = useId();
  const [event, setEvent] = useState(events[0]?.key ?? "");
  const [channel, setChannel] = useState<Channel | "inbox">("sms");
  const find = (e: string, c: string) => templates.find((t) => t.event === e && t.channel === c);
  const cur = find(event, channel);
  const [subject, setSubject] = useState(cur?.subject ?? "");
  const [body, setBody] = useState(cur?.body ?? "");
  const [ext, setExt] = useState(cur?.externalId ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const pick = (e: string, c: Channel | "inbox") => {
    const t = find(e, c);
    setEvent(e); setChannel(c); setSubject(t?.subject ?? ""); setBody(t?.body ?? ""); setExt(t?.externalId ?? ""); setMsg(null);
  };
  return (
    <Card>
      <CardHeader title="Wording" action={<span className="text-[12px] text-ink-500">Optional; empty uses the standard wording</span>} />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Message" htmlFor={`${uid}-e`}>
            <Select id={`${uid}-e`} value={event} onChange={(e) => pick(e.target.value, channel)}>
              {events.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </Select>
          </Field>
          <Field label="Where" htmlFor={`${uid}-c`}>
            <Select id={`${uid}-c`} value={channel} onChange={(e) => pick(event, e.target.value as Channel | "inbox")}>
              <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="inbox">In the app</option>
            </Select>
          </Field>
        </div>
        {(channel === "email" || channel === "inbox") && (
          <Field label={channel === "email" ? "Email subject" : "Title"} htmlFor={`${uid}-s`}>
            <Input id={`${uid}-s`} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        )}
        <Field label="Text" htmlFor={`${uid}-b`} hint="You can use {student}, {school}, {date}, {amount} and the other names shown in each message.">
          <Textarea id={`${uid}-b`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {(channel === "sms" || channel === "whatsapp") && (
          <Field label={channel === "sms" ? "DLT template id" : "WhatsApp template name"} htmlFor={`${uid}-x`}
            hint={channel === "sms" ? "The id of this exact text as registered on DLT. Operators block SMS that do not match." : "The approved template this text matches."}>
            <Input id={`${uid}-x`} value={ext} onChange={(e) => setExt(e.target.value)} />
          </Field>
        )}
        <Button disabled={pending} onClick={() => start(async () => {
          const r = await saveTemplate({ event, channel, subject, body, externalId: ext });
          setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
        })}>{pending ? "Saving…" : "Save wording"}</Button>
        <Msg m={msg} />
      </CardBody>
    </Card>
  );
}
