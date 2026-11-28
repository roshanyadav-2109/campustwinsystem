"use server";
import { isFinance } from "@/lib/roles";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { GATEWAY_CHOICES, CONNECTED } from "@/core/payments/choices";

// Settings → Online payment (office). The institution adds its own gateway(s)
// and keys; one is active for new payments. Keys go to Vault.
export type Result = { ok: true; message?: string } | { ok: false; error: string };
const PATH = "/dashboard/settings/payments";
async function office() { const s = await getSession(); return isFinance(s) ? s : null; }

export async function addGateway(input: { provider: string; mode: "live" | "test"; label: string; merchantId: string }): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change payment settings." };
  if (!GATEWAY_CHOICES.some((g) => g.id === input.provider)) return { ok: false, error: "Choose a gateway." };
  const mode = input.provider === "test" ? "test" : input.mode === "test" ? "test" : "live";
  const supabase = await createClient();
  const { error } = await supabase.from("payment_gateway" as never).insert({
    provider: input.provider, mode, label: input.label.trim().slice(0, 60) || null,
    config: input.merchantId.trim() ? { merchant_id: input.merchantId.trim().slice(0, 80) } : {},
  } as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "This gateway is already added in this mode." : error.message.includes("demo institutions") ? "The test gateway is only for demo institutions. Add your school's own gateway." : "Could not add the gateway." };
  revalidatePath(PATH);
  return { ok: true, message: "Added." };
}

export async function saveGatewayKeys(gatewayId: number, keysJson: string): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change payment settings." };
  let parsed: unknown;
  try { parsed = JSON.parse(keysJson); } catch { return { ok: false, error: "Write the keys as JSON, for example {\"key_id\": \"...\", \"key_secret\": \"...\"}." }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || keysJson.length > 4000) return { ok: false, error: "Keys must be a JSON object." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_payment_gateway_secret" as never, { p_gateway: gatewayId, p_secret: JSON.stringify(parsed) } as never);
  if (error) return { ok: false, error: "Could not save the keys." };
  revalidatePath(PATH);
  return { ok: true, message: "Keys saved securely. They will not be shown again." };
}

export async function setActiveGateway(gatewayId: number | null): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can change payment settings." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_active_gateway" as never, { p_gateway: gatewayId, p_connected: [...CONNECTED] } as never);
  if (error) {
    if (error.message.includes("not connected")) return { ok: false, error: "CampusTwin connects this gateway for you once your merchant account and keys are ready. Until then, parents pay at the office." };
    if (error.message.includes("keys first")) return { ok: false, error: "Save the gateway keys first." };
    return { ok: false, error: "Could not change the gateway." };
  }
  revalidatePath(PATH);
  revalidatePath("/dashboard/fees");
  return { ok: true, message: gatewayId ? "Online payment is on. Parents see Pay buttons on their bills." : "Online payment is off." };
}

export async function resolvePayment(orderId: number, note: string): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office can resolve payments." };
  if (!note.trim()) return { ok: false, error: "Write what was done (for example: refunded by bank transfer on 2 Dec)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_payment_order" as never, { p_order: orderId, p_note: note.trim().slice(0, 300) } as never);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath(PATH);
  return { ok: true, message: "Marked as resolved." };
}

// Razorpay: the key id is public (the payer's browser needs it); the key secret and the webhook secret go to the vault.
// The webhook secret is made here (32 random bytes) and shown once, to paste into Razorpay; replacing the keys keeps it
// unless a new one is asked for.
export async function saveRazorpayKeys(gatewayId: number, input: { keyId: string; keySecret: string; newWebhookSecret: boolean }): Promise<Result & { webhookSecret?: string }> {
  const s = await office();
  if (!s) return { ok: false, error: "Only the office or the finance head can change payment settings." };
  const keyId = input.keyId.trim(), keySecret = input.keySecret.trim();
  if (!/^rzp_(test|live)_[A-Za-z0-9]{8,32}$/.test(keyId)) return { ok: false, error: "The Key ID starts with rzp_live_ (or rzp_test_ in test mode). Copy it from Razorpay, Account & Settings, API keys." };
  if (keySecret.length < 10 || keySecret.length > 100) return { ok: false, error: "Paste the Key Secret shown when the key was made in Razorpay." };
  const supabase = await createClient();
  const { data: g } = await supabase.from("payment_gateway" as never).select("id, provider, mode").eq("id", gatewayId).maybeSingle();
  const gw = g as unknown as { provider: string; mode: string } | null;
  if (!gw || gw.provider !== "razorpay") return { ok: false, error: "Unknown gateway." };
  if ((gw.mode === "test") !== keyId.startsWith("rzp_test_")) return { ok: false, error: gw.mode === "test" ? "This gateway is in test mode: use a key starting rzp_test_." : "This gateway is live: use a key starting rzp_live_." };
  // keep the webhook secret already saved, unless a new one is asked for
  let webhook = "";
  if (!input.newWebhookSecret) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data } = await createAdminClient().rpc("payment_gateway_keys" as never, { p_gateway: gatewayId, p_school: s.schoolId } as never);
    const row = ((data ?? []) as unknown as { secret: string | null }[])[0];
    try { webhook = row?.secret ? String(JSON.parse(row.secret).webhook_secret ?? "") : ""; } catch { webhook = ""; }
  }
  const made = !webhook;
  if (made) webhook = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await supabase.rpc("set_payment_gateway_keys" as never, { p_gateway: gatewayId, p_secret: JSON.stringify({ key_secret: keySecret, webhook_secret: webhook }), p_config: { key_id: keyId } } as never);
  if (error) return { ok: false, error: "Could not save the keys." };
  revalidatePath(PATH);
  return made
    ? { ok: true, message: "Keys saved securely. Copy the webhook secret below into Razorpay now: it is shown only this once.", webhookSecret: webhook }
    : { ok: true, message: "Keys saved securely; the webhook secret already in Razorpay still works. Now test the connection." };
}

// Ask Razorpay whether the saved keys work (reads one order; changes nothing).
export async function testGatewayConnection(gatewayId: number): Promise<Result> {
  const s = await office();
  if (!s) return { ok: false, error: "Only the office or the finance head can change payment settings." };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data } = await createAdminClient().rpc("payment_gateway_keys" as never, { p_gateway: gatewayId, p_school: s.schoolId } as never);
  const row = ((data ?? []) as unknown as { provider: string; mode: string; config: Record<string, unknown>; secret: string | null }[])[0];
  if (!row) return { ok: false, error: "Unknown gateway." };
  if (row.provider !== "razorpay") {
    const { HOSTED } = await import("@/core/payments/hosted-list");
    const { keysOf } = await import("@/core/payments/hosted");
    const g = HOSTED[row.provider];
    const keys = g ? keysOf(row, g.fields) : null;
    if (!g?.test) return { ok: false, error: "A connection test is not available for this gateway." };
    if (!keys) return { ok: false, error: "Save the keys first." };
    const t = await g.test(keys, row.mode as "live" | "test");
    return t.ok ? { ok: true, message: `Connected to ${g.label}${row.mode === "test" ? " (test mode)" : ""}. Switch it on for parents when ready.` } : { ok: false, error: t.error };
  }
  const { razorpayKeys, razorpayApi } = await import("@/core/payments/razorpay");
  const keys = razorpayKeys(row);
  if (!keys) return { ok: false, error: "Save the keys first." };
  const r = await razorpayApi(keys, "/orders?count=1");
  if (!r.ok) return { ok: false, error: r.status === 401 ? "Razorpay did not accept these keys. Check the Key ID and Key Secret." : `Razorpay could not be reached (${r.error}). Try again shortly.` };
  return { ok: true, message: `Connected to Razorpay${row.mode === "test" ? " (test mode)" : ""}. Switch it on for parents when ready.` };
}

export type PaymentProfileInput = Record<string, string | boolean>;
export async function savePaymentProfile(p: PaymentProfileInput, pan: string, bankAccount: string): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office or the finance head can change payment settings." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_payment_profile" as never, { p, p_pan: pan || null, p_bank_account: bankAccount || null } as never);
  if (error) return { ok: false, error: error.code === "P0001" || error.message.length < 120 ? error.message.replace(/^.*violates check constraint.*$/, "Check the GSTIN and IFSC format.") : "Could not save." };
  revalidatePath(PATH);
  revalidatePath("/policies", "layout");
  return { ok: true, message: "Saved. Your policy pages now show these details." };
}

// Keys of a hosted gateway (PayU, Cashfree, Easebuzz, CCAvenue): public fields to its settings, secret ones to the vault.
export async function saveHostedKeys(gatewayId: number, values: Record<string, string>): Promise<Result> {
  if (!(await office())) return { ok: false, error: "Only the office or the finance head can change payment settings." };
  const { GATEWAY_FIELDS } = await import("@/core/payments/choices");
  const supabase = await createClient();
  const { data: g } = await supabase.from("payment_gateway" as never).select("id, provider").eq("id", gatewayId).maybeSingle();
  const fields = g ? GATEWAY_FIELDS[(g as unknown as { provider: string }).provider] : undefined;
  if (!fields) return { ok: false, error: "Unknown gateway." };
  const config: Record<string, string> = {}, secret: Record<string, string> = {};
  for (const f of fields) {
    const v = String(values[f.name] ?? "").trim();
    if (!v || v.length > 200 || /\s/.test(v)) return { ok: false, error: `Enter the ${f.label.toLowerCase()} exactly as shown by the gateway.` };
    (f.secret ? secret : config)[f.name] = v;
  }
  const { error } = await supabase.rpc("set_payment_gateway_keys" as never, { p_gateway: gatewayId, p_secret: JSON.stringify(secret), p_config: config } as never);
  if (error) return { ok: false, error: "Could not save the keys." };
  revalidatePath(PATH);
  return { ok: true, message: "Keys saved securely; the secret will not be shown again. Now test the connection." };
}
