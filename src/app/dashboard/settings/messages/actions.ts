"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

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
  url?: string; method?: string; body?: string; headers?: string;    // http
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
    config = { url, method, headers, body };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("notification_setting" as never)
    .upsert({ channel: input.channel, provider: input.provider, config, updated_at: new Date().toISOString() } as never, { onConflict: "school_id,channel" });
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
