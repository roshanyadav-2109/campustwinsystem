"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { safeGatewayUrl } from "@/core/notifications/providers";

// Settings → Messages and alerts. The office chooses, per channel, how messages
// go out. Keys go straight into Vault and are never shown again.
export type Channel = "email" | "sms" | "whatsapp";
export type Provider = "off" | "log" | "http" | "ses";
export type Result = { ok: true; message?: string } | { ok: false; error: string };

const CHANNELS: Channel[] = ["email", "sms", "whatsapp"];
const ALLOWED: Record<Channel, Provider[]> = { email: ["off", "log", "ses"], sms: ["off", "log", "http"], whatsapp: ["off", "log", "http"] };
const REGION = /^[a-z]{2}-[a-z]+-\d$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function office() {
  const s = await getSession();
  return s?.staffRole === "office" ? s : null;
}

export type ChannelInput = {
  channel: Channel; provider: Provider;
  region?: string; from?: string;                                    // ses
  url?: string; method?: string; body?: string; headers?: string; contentType?: "json" | "form";   // http
  dailyLimit?: string;
};

export async function saveChannel(input: ChannelInput): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change message settings." };
  if (!CHANNELS.includes(input.channel) || !ALLOWED[input.channel].includes(input.provider)) return { ok: false, error: "That choice is not available for this channel." };
  let config: Record<string, unknown> = {};
  if (input.provider === "ses") {
    const region = (input.region ?? "").trim(), from = (input.from ?? "").trim();
    if (!REGION.test(region)) return { ok: false, error: "Enter the Amazon SES region, for example ap-south-1." };
    if (!EMAIL.test(from) || from.length > 200) return { ok: false, error: "Enter the sending email address verified in Amazon SES." };
    config = { region, from };
  }
  if (input.provider === "http") {
    const url = (input.url ?? "").trim();
    if (!/^https:\/\/[^\s]+$/.test(url) || url.length > 500) return { ok: false, error: "The provider address must start with https://." };
    if (!safeGatewayUrl(url.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, "x"))) return { ok: false, error: "Use the provider's public web address (not an IP address or a CampusTwin address)." };
    const method = (input.method ?? "POST").toUpperCase();
    if (!["POST", "GET"].includes(method)) return { ok: false, error: "Method must be POST or GET." };
    let headers: Record<string, string> = {};
    if (input.headers?.trim()) {
      try {
        const h = JSON.parse(input.headers);
        if (!h || typeof h !== "object" || Array.isArray(h)) throw new Error();
        headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [String(k), String(v)]));
      } catch { return { ok: false, error: "Headers must be written as JSON, for example {\"Authorization\": \"Bearer {api_key}\"}." }; }
    }
    const body = (input.body ?? "").slice(0, 2000);
    config = { url, method, headers, body, content_type: input.contentType === "form" ? "form" : "json" };
  }
  const lim = (input.dailyLimit ?? "").trim();
  if (lim && !/^\d{1,7}$/.test(lim)) return { ok: false, error: "The daily limit must be a whole number, or empty for no limit." };
  const daily_limit = lim ? Number(lim) : null;
  const supabase = await createClient();
  const { error } = await supabase.from("notification_setting" as never)
    .upsert({ channel: input.channel, provider: input.provider, config, daily_limit, updated_at: new Date().toISOString() } as never, { onConflict: "school_id,channel" });
  if (error) return { ok: false, error: "Could not save. Please try again." };
  revalidatePath("/dashboard/settings/messages");
  return { ok: true, message: input.provider === "off" ? "Switched off." : "Saved." };
}

export async function saveChannelKeys(channel: Channel, keysJson: string): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change message settings." };
  if (!CHANNELS.includes(channel)) return { ok: false, error: "Unknown channel." };
  let parsed: unknown;
  try { parsed = JSON.parse(keysJson); } catch { return { ok: false, error: "Keys must be written as JSON, for example {\"api_key\": \"...\"}." }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || keysJson.length > 4000) return { ok: false, error: "Keys must be a JSON object." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_secret" as never, { p_channel: channel, p_secret: JSON.stringify(parsed) } as never);
  if (error) return { ok: false, error: "Could not save the keys." };
  revalidatePath("/dashboard/settings/messages");
  return { ok: true, message: "Keys saved. They are stored securely and will not be shown again." };
}

export async function sendTestMessage(): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can send a test message." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_test_notification" as never);
  if (error) return { ok: false, error: error.message.includes("Too many") ? "Too many test messages this hour." : "Could not send the test message." };
  revalidatePath("/dashboard/settings/messages");
  return { ok: true, message: "Test message sent to you. It is in your notifications, and on each channel that is switched on." };
}

// Which events go out on which channel (the inbox always gets everything).
export async function saveEventChannels(choices: { event: string; channel: Channel; enabled: boolean }[]): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change message settings." };
  const rows = choices.filter((c) => CHANNELS.includes(c.channel) && /^[a-z_]{1,60}$/.test(c.event)).slice(0, 200)
    .map((c) => ({ event_key: c.event, channel: c.channel, enabled: !!c.enabled }));
  const supabase = await createClient();
  const { error } = await supabase.from("notification_event_channel" as never).upsert(rows as never, { onConflict: "school_id,event_key,channel" });
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath("/dashboard/settings/messages");
  return { ok: true, message: "Saved." };
}

// The institution's own wording for an event on one channel, with the
// registered template id (DLT for SMS, the approved template for WhatsApp).
export async function saveTemplate(input: { event: string; channel: Channel | "inbox"; subject: string; body: string; externalId: string }): Promise<Result> {
  const s = await office();
  if (!s) return { ok: false, error: "Only the office can change message settings." };
  if (!/^[a-z_]{1,60}$/.test(input.event) || !["inbox", ...CHANNELS].includes(input.channel)) return { ok: false, error: "Unknown message." };
  const body = input.body.trim();
  const supabase = await createClient();
  const existing = await supabase.from("notification_template" as never).select("id")
    .eq("school_id", s.schoolId).eq("event_key", input.event).eq("channel", input.channel).maybeSingle();
  const id = (existing.data as { id: number } | null)?.id;
  if (!body) {
    if (id) await supabase.from("notification_template" as never).delete().eq("id", id);
    revalidatePath("/dashboard/settings/messages");
    return { ok: true, message: "Back to the standard wording." };
  }
  if (body.length > 2000 || input.subject.length > 200 || input.externalId.length > 80) return { ok: false, error: "Too long." };
  const row = { school_id: s.schoolId, event_key: input.event, channel: input.channel, subject: input.subject.trim() || null, body, external_id: input.externalId.trim() || null, active: true };
  const { error } = id
    ? await supabase.from("notification_template" as never).update(row as never).eq("id", id)
    : await supabase.from("notification_template" as never).insert(row as never);
  if (error) return { ok: false, error: "Could not save the wording." };
  revalidatePath("/dashboard/settings/messages");
  return { ok: true, message: "Saved." };
}
