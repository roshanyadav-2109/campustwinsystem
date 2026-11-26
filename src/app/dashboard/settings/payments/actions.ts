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
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "This gateway is already added in this mode." : "Could not add the gateway." };
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
  if (gatewayId) {
    const { data } = await supabase.from("payment_gateway" as never).select("provider, secret_id").eq("id", gatewayId).maybeSingle();
    const g = data as unknown as { provider: string; secret_id: string | null } | null;
    if (!g) return { ok: false, error: "Unknown gateway." };
    if (!CONNECTED.has(g.provider)) return { ok: false, error: "CampusTwin connects this gateway for you once your merchant account and keys are ready. Until then, use the test gateway or pay at the office." };
  }
  const { error: offErr } = await supabase.from("payment_gateway" as never).update({ active: false, updated_at: new Date().toISOString() } as never).eq("active", true);
  if (offErr) return { ok: false, error: "Could not change the gateway." };
  if (gatewayId) {
    const { error } = await supabase.from("payment_gateway" as never).update({ active: true, updated_at: new Date().toISOString() } as never).eq("id", gatewayId);
    if (error) return { ok: false, error: "Could not switch it on." };
  }
  revalidatePath(PATH);
  revalidatePath("/dashboard/fees");
  return { ok: true, message: gatewayId ? "Online payment is on. Parents see Pay buttons on their bills." : "Online payment is off." };
}
