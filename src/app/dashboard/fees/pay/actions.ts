"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONNECTORS, checkTestOrder, type GatewayOrder } from "@/core/payments/gateways";

// Online fee payment, the payer's side. The bill's balance is the amount;
// the database credits a payment once, whatever the gateway sends.

async function orderForGateway(publicId: string): Promise<GatewayOrder | null> {
  const { data } = await createAdminClient().rpc("payment_order_for_gateway" as never, { p_public_id: publicId } as never);
  return ((data ?? []) as unknown as GatewayOrder[])[0] ?? null;
}

export async function startOnlinePayment(invoiceId: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) return { ok: false, error: "Choose a bill." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_payment_order" as never, { p_invoice: invoiceId } as never);
  if (error) return { ok: false, error: error.message.length < 160 ? error.message : "Could not start the payment." };
  const row = ((data ?? []) as unknown as { order_public_id: string; provider: string }[])[0];
  if (!row) return { ok: false, error: "Could not start the payment." };
  const connector = CONNECTORS[row.provider];
  if (!connector) return { ok: false, error: "Online payment is being set up at your school. Please pay at the office for now." };
  const order = await orderForGateway(row.order_public_id);
  if (!order) return { ok: false, error: "Could not start the payment." };
  const h = await headers();
  const origin = `https://${h.get("host")}`;
  const out = await connector.checkout(order, { origin, returnUrl: `${origin}/dashboard/fees/payment/${order.public_id}` });
  if (!out.ok) return { ok: false, error: out.error };
  if (out.providerOrderId) await createAdminClient().rpc("set_payment_order_ref" as never, { p_public_id: order.public_id, p_provider_order_id: out.providerOrderId } as never);
  return { ok: true, url: out.redirectUrl };
}

// The built-in test gateway's "Pay" / "Cancel" buttons.
export async function finishTestPayment(form: FormData) {
  const publicId = String(form.get("order") ?? ""), sig = String(form.get("s") ?? ""), outcome = String(form.get("outcome") ?? "");
  if (!/^[a-f0-9]{24}$/.test(publicId) || !checkTestOrder(publicId, sig)) redirect("/dashboard/fees");
  // the payer must be the one who started it
  const supabase = await createClient();
  const { data: mine } = await supabase.from("payment_order" as never).select("public_id").eq("public_id", publicId).maybeSingle();
  if (!mine) redirect("/dashboard/fees");
  const order = await orderForGateway(publicId);
  if (!order || order.provider !== "test" || order.mode !== "test") redirect("/dashboard/fees");
  if (order.status !== "created") redirect(`/dashboard/fees/payment/${publicId}`);   // a second click changes nothing
  const admin = createAdminClient();
  if (outcome === "pay") {
    await admin.rpc("complete_payment_order" as never, {
      p_public_id: publicId, p_provider_payment_id: `test_${publicId}`, p_amount: order.amount,
      p_method: "test",
    } as never);
  } else {
    await admin.rpc("fail_payment_order" as never, { p_public_id: publicId, p_reason: "Cancelled on the test gateway" } as never);
  }
  redirect(`/dashboard/fees/payment/${publicId}`);
}
