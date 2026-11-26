// Sending one message through an institution's provider. Shared by every
// edition. Providers:
//   ses   Amazon SES (email). config: { region, from }; secret: { accessKeyId, secretAccessKey }
//   http  any SMS / WhatsApp gateway. config: { url, method?, headers?, body, content_type?: "json" | "form" };
//         the address, headers and body may use {to}, {text}, {subject},
//         {template_id} and any key of the secret JSON (e.g. {api_key}), so a
//         provider is set up by the institution without code.
// Keys come from Vault through the dispatcher; they never reach a browser.
import { AwsClient } from "aws4fetch";

export type Delivery = {
  id: number; channel: "sms" | "whatsapp" | "email"; provider: string;
  to_address: string | null; subject: string | null; body: string; external_id: string | null;
  config: Record<string, unknown> | null; secret: string | null;
};
export type SendResult = { ok: true; ref: string } | { ok: false; error: string };

const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1);

function fill(template: string, vars: Record<string, string>, mode: "plain" | "json" | "url"): string {
  return template.replace(PLACEHOLDER, (_, k: string) => {
    const v = vars[k] ?? "";
    return mode === "json" ? jsonEscape(v) : mode === "url" ? encodeURIComponent(v) : v;
  });
}

function parseSecret(secret: string | null): Record<string, string> {
  if (!secret) return {};
  try {
    const o = JSON.parse(secret);
    return o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) : {};
  } catch { return {}; }
}

async function sendSes(d: Delivery): Promise<SendResult> {
  const cfg = (d.config ?? {}) as { region?: string; from?: string };
  const key = parseSecret(d.secret);
  if (!cfg.region || !/^[a-z]{2}-[a-z]+-\d$/.test(cfg.region) || !cfg.from) return { ok: false, error: "Email is not set up: region and from address are needed." };
  if (!key.accessKeyId || !key.secretAccessKey) return { ok: false, error: "Email keys are missing." };
  if (!d.to_address) return { ok: false, error: "No email address." };
  const aws = new AwsClient({ accessKeyId: key.accessKeyId, secretAccessKey: key.secretAccessKey, service: "ses", region: cfg.region });
  const res = await aws.fetch(`https://email.${cfg.region}.amazonaws.com/v2/email/outbound-emails`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      FromEmailAddress: cfg.from,
      Destination: { ToAddresses: [d.to_address] },
      Content: { Simple: { Subject: { Data: d.subject ?? "", Charset: "UTF-8" }, Body: { Text: { Data: d.body, Charset: "UTF-8" } } } },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let m = "";
    try { m = String(JSON.parse(text).message ?? ""); } catch { /* not JSON */ }
    return { ok: false, error: `SES ${res.status}${m ? ": " + m.slice(0, 150) : ""}` };
  }
  try { return { ok: true, ref: String(JSON.parse(text).MessageId ?? "ses").slice(0, 80) }; } catch { return { ok: true, ref: "ses" }; }
}

// The institution types the gateway address, and the request runs on our
// servers, so it must never reach our own services or a private network.
const BLOCKED_HOST = /(^|\.)(localhost|campustwin\.org|workers\.dev|supabase\.co|supabase\.in|cloudflarestorage\.com|internal|local)$/i;
export function safeGatewayUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".") || BLOCKED_HOST.test(h)) return null;
  return u;
}

async function sendHttp(d: Delivery): Promise<SendResult> {
  const cfg = (d.config ?? {}) as { url?: string; method?: string; headers?: Record<string, string>; body?: string; content_type?: string };
  if (!d.to_address) return { ok: false, error: "No phone number." };
  const vars: Record<string, string> = { ...parseSecret(d.secret), to: d.to_address, text: d.body, subject: d.subject ?? "", template_id: d.external_id ?? "" };
  const url = safeGatewayUrl(fill(cfg.url ?? "", vars, "url"));
  if (!url) return { ok: false, error: "The gateway address is not allowed. Use the provider's public https address." };
  const method = (cfg.method || "POST").toUpperCase() === "GET" ? "GET" : "POST";
  const form = cfg.content_type === "form";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.headers ?? {})) headers[k] = fill(String(v), vars, "plain");
  let body: string | undefined;
  if (method === "POST") {
    headers["Content-Type"] = form ? "application/x-www-form-urlencoded" : "application/json";
    body = form
      ? fill(cfg.body || "to={to}&text={text}", vars, "url")
      : cfg.body ? fill(cfg.body, vars, "json") : JSON.stringify({ to: d.to_address, text: d.body, template_id: d.external_id });
  }
  const res = await fetch(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(10000) });
  await res.body?.cancel().catch(() => {});
  if (res.status >= 300 && res.status < 400) return { ok: false, error: `Gateway redirected (${res.status}); use its final address.` };
  return res.ok ? { ok: true, ref: `HTTP ${res.status}` } : { ok: false, error: `Gateway answered ${res.status}.` };
}

export async function sendDelivery(d: Delivery): Promise<SendResult> {
  try {
    if (d.provider === "ses") return await sendSes(d);
    if (d.provider === "http") return await sendHttp(d);
    return { ok: false, error: `Unknown provider ${d.provider}` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, error: name === "TimeoutError" ? "The provider did not answer in 10 seconds." : "Sending failed." };
  }
}
