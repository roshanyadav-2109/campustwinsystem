import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Online payment connectors. Every gateway (BillDesk, Paytm, Razorpay, PayU,
// Cashfree, CCAvenue ...) is one small connector with the same shape; the
// institution chooses its gateway and enters its own keys in Settings. Money
// goes straight to the institution's merchant account.
//
// A connector never decides the amount (it comes from the bill in the
// database) and never credits a payment itself: after verifying the
// gateway's signature it calls complete_payment_order, which is idempotent.

export type GatewayOrder = {
  id: number; school_id: number; public_id: string; amount: number; currency: string; status: string;
  provider: string; mode: "live" | "test"; provider_order_id: string | null;
  config: Record<string, unknown>; secret: string | null;
  payer_name: string | null; payer_email: string | null; payer_phone: string | null;
  student_name: string; school_name: string; school_slug: string | null; expires_at: string;
};
export type Checkout = { ok: true; redirectUrl: string; providerOrderId?: string } | { ok: false; error: string };
export type WebhookOutcome =
  | { kind: "paid"; publicId: string; paymentId: string; amount: number; providerOrderId?: string; paidAt?: string; method?: string; fee?: number }
  | { kind: "failed"; publicId: string; reason: string }
  | { kind: "refund"; publicId: string; amount: number; ref: string; chargeback?: boolean }
  | { kind: "ignored" };

export interface GatewayConnector {
  id: string;
  label: string;
  /** Start a payment: where to send the payer. */
  checkout(order: GatewayOrder, ctx: { origin: string; returnUrl: string; publicFlow?: boolean }): Promise<Checkout>;
  /** A server-to-server notice from the gateway; must verify its signature. */
  webhook?(request: Request, lookup: (publicId: string) => Promise<GatewayOrder | null>): Promise<WebhookOutcome>;
}

// Server-only signing for links the app makes itself (the test gateway).
function key() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("server key missing");
  return createHmac("sha256", k).update("campustwin:test-gateway").digest();
}
export function signTestOrder(publicId: string) {
  return createHmac("sha256", key()).update(publicId).digest("hex").slice(0, 32);
}
export function checkTestOrder(publicId: string, sig: string) {
  const a = Buffer.from(signTestOrder(publicId)), b = Buffer.from(sig ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

// The built-in test gateway: no money moves. The payer sees a page with
// "Pay" and "Cancel" and the result is recorded exactly like a real payment
// (receipts say TEST and never reach Finance).
const testGateway: GatewayConnector = {
  id: "test",
  label: "Test gateway (no real money)",
  async checkout(order, ctx) {
    if (order.mode !== "test") return { ok: false, error: "The test gateway only works in test mode." };
    return { ok: true, redirectUrl: `${ctx.publicFlow ? "/apply/pay/test" : "/dashboard/fees/pay/test"}/${order.public_id}?s=${signTestOrder(order.public_id)}` };
  },
};

import { razorpay } from "@/core/payments/razorpay";
export const CONNECTORS: Record<string, GatewayConnector> = { test: testGateway, razorpay };

export { GATEWAY_CHOICES } from "@/core/payments/choices";
export const hasConnector = (id: string) => id in CONNECTORS;
