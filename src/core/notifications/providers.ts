// Sending one message through an institution's provider. Shared by every
// edition. Providers:
//   ses   Amazon SES (email). config: { region, from }; secret: { accessKeyId, secretAccessKey }
//   http  any SMS / WhatsApp gateway. config: { url, method?, headers?, body }; the
//         body and header templates may use {to}, {text}, {subject}, {template_id}
//         and any key of the secret JSON (e.g. {api_key}), so a provider is set
//         up by the institution without code.
// Keys come from Vault through the dispatcher; they never reach a browser.
import { AwsClient } from "aws4fetch";

export type Delivery = {
  id: number; channel: "sms" | "whatsapp" | "email"; provider: string;
  to_address: string | null; subject: string | null; body: string; external_id: string | null;
  config: Record<string, unknown> | null; secret: string | null;
};
export type SendResult = { ok: true; ref: string } | { ok: false; error: string };

const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1);

function fill(template: string, vars: Record<string, string>, escapeJson: boolean): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, k: string) => {
    const v = vars[k] ?? "";
    return escapeJson ? jsonEscape(v) : v;
  });
}

function parseSecret(secret: string | null): Record<string, string> {
  if (!secret) return {};
  try { const o = JSON.parse(secret); return o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) : {}; }
  catch { return {}; }
}

async function sendSes(d: Delivery): Promise<SendResult> {
  const cfg = (d.config ?? {}) as { region?: string; from?: string };
  const key = parseSecret(d.secret);
  if (!cfg.region || !cfg.from) return { ok: false, error: "Email is not set up: region and from address are needed." };
  if (!key.accessKeyId || !key.secretAccessKey) return { ok: false, error: "Email keys are missing." };
  if (!d.to_address) return { ok: false, error: "No email address." };
  const aws = new AwsClient({ accessKeyId: key.accessKeyId, secretAccessKey: key.secretAccessKey, service: "ses", region: cfg.region });
  const res = await aws.fetch(`https://email.${cfg.region}.amazonaws.com/v2/email/outbound-emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      FromEmailAddress: cfg.from,
      Destination: { ToAddresses: [d.to_address] },
      Content: { Simple: { Subject: { Data: d.subject ?? "", Charset: "UTF-8" }, Body: { Text: { Data: d.body, Charset: "UTF-8" } } } },
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `SES ${res.status}: ${text.slice(0, 300)}` };
  try { return { ok: true, ref: String(JSON.parse(text).MessageId ?? "ses") }; } catch { return { ok: true, ref: "ses" }; }
}

async function sendHttp(d: Delivery): Promise<SendResult> {
  const cfg = (d.config ?? {}) as { url?: string; method?: string; headers?: Record<string, string>; body?: string; content_type?: string };
  if (!cfg.url || !/^https:\/\//.test(cfg.url)) return { ok: false, error: "The gateway address must start with https://." };
  if (!d.to_address) return { ok: false, error: "No phone number." };
  const vars: Record<string, string> = { ...parseSecret(d.secret), to: d.to_address, text: d.body, subject: d.subject ?? "", template_id: d.external_id ?? "" };
  const contentType = cfg.content_type || "application/json";
  const headers: Record<string, string> = { "Content-Type": contentType };
  for (const [k, v] of Object.entries(cfg.headers ?? {})) headers[k] = fill(String(v), vars, false);
  const body = cfg.body ? fill(cfg.body, vars, contentType.includes("json")) : JSON.stringify({ to: d.to_address, text: d.body, template_id: d.external_id });
  const res = await fetch(fill(cfg.url, vars, false), { method: (cfg.method || "POST").toUpperCase(), headers, body });
  const text = await res.text().catch(() => "");
  return res.ok ? { ok: true, ref: text.slice(0, 120) || String(res.status) } : { ok: false, error: `Gateway ${res.status}: ${text.slice(0, 300)}` };
}

export async function sendDelivery(d: Delivery): Promise<SendResult> {
  try {
    if (d.provider === "ses") return await sendSes(d);
    if (d.provider === "http") return await sendHttp(d);
    return { ok: false, error: `Unknown provider ${d.provider}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Sending failed" };
  }
}
