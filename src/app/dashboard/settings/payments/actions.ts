"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { GATEWAY_CHOICES, CONNECTED } from "@/core/payments/choices";

// Settings → Online payment (office). The institution adds its own gateway(s)
// and keys; one is active for new payments. Keys go to Vault.
export type Result = { ok: true; message?: string } | { ok: false; error: string };
const PATH = "/dashboard/settings/payments";
async function office() { const s = await getSession(); return s?.staffRole === "office" ? s : null; }

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
