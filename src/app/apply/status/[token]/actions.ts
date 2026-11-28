"use server";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { CONNECTORS, type GatewayOrder } from "@/core/payments/gateways";

// The family's private application page: no login, the link is the key.
const anon = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const ok = (t: string) => /^[a-f0-9]{32}$/.test(t);
const msg = (e: { message: string } | null, f: string) => (e && e.message.length < 160 && !/violates|function|relation/.test(e.message) ? e.message : f);

export async function respondOffer(token: string, accept: boolean): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!ok(token)) return { ok: false, error: "This link is not valid." };
  const { data, error } = await anon().rpc("respond_offer" as never, { p_token: token, p_accept: accept } as never);
  if (error) return { ok: false, error: msg(error, "Could not save your answer. Please try again.") };
  return { ok: true, message: data === "accepted" ? "Thank you. The seat is confirmed; the school office will complete the admission." : "Your answer is recorded. The seat is released." };
}

export async function payApplicationFee(token: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ok(token)) return { ok: false, error: "This link is not valid." };
  const { data, error } = await anon().rpc("create_application_payment" as never, { p_token: token } as never);
  if (error) return { ok: false, error: msg(error, "Could not start the payment.") };
  const row = ((data ?? []) as unknown as { order_public_id: string; provider: string }[])[0];
  const connector = row ? CONNECTORS[row.provider] : null;
  if (!row || !connector) return { ok: false, error: "Online payment is being set up at this school. Please pay at the office for now." };
  const admin = createAdminClient();
  const { data: o } = await admin.rpc("payment_order_for_gateway" as never, { p_public_id: row.order_public_id } as never);
  const order = ((o ?? []) as unknown as GatewayOrder[])[0];
  if (!order) return { ok: false, error: "Could not start the payment." };
  const h = await headers();
  const origin = `https://${h.get("host")}`;
  const out = await connector.checkout(order, { origin, returnUrl: `${origin}/apply/status/${token}`, publicFlow: true });
  if (!out.ok) return { ok: false, error: out.error };
  if (out.providerOrderId) await admin.rpc("set_payment_order_ref" as never, { p_public_id: order.public_id, p_provider_order_id: out.providerOrderId } as never);
  return { ok: true, url: out.redirectUrl };
}
