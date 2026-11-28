import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayConnector, GatewayOrder, WebhookOutcome } from "@/core/payments/gateways";

// Razorpay, on the institution's own merchant account.
//   config (public): { key_id }            — the browser's checkout needs it anyway
//   secret (Vault):  { key_secret, webhook_secret }
// The payer pays on Razorpay's checkout over our page; Razorpay posts the result back to us, we check its
// signature with the institution's key secret, read the payment from Razorpay and record it once. Razorpay's
// webhook (signed with the institution's webhook secret) records it too if the payer closes the page early.

const API = "https://api.razorpay.com/v1";
type Keys = { key_id: string; key_secret: string; webhook_secret?: string };
export type RazorpayPayment = { id: string; order_id: string; status: string; amount: number; currency: string; method?: string; fee?: number; created_at?: number; notes?: Record<string, string> };

export function razorpayKeys(o: Pick<GatewayOrder, "config" | "secret">): Keys | null {
  const keyId = String((o.config as { key_id?: string })?.key_id ?? "");
  let s: { key_secret?: string; webhook_secret?: string } = {};
  try { s = o.secret ? JSON.parse(o.secret) : {}; } catch { return null; }
  if (!keyId || !s.key_secret) return null;
  return { key_id: keyId, key_secret: s.key_secret, webhook_secret: s.webhook_secret };
}

export async function razorpayApi<T>(keys: Pick<Keys, "key_id" | "key_secret">, path: string, init?: { method?: string; body?: unknown }): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${keys.key_id}:${keys.key_secret}`).toString("base64")}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
  if (!res.ok) return { ok: false, status: res.status, error: json?.error?.description ?? `Razorpay answered ${res.status}` };
  return { ok: true, data: json };
}

const hmac = (secret: string, text: string) => createHmac("sha256", secret).update(text).digest("hex");
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b ?? ""); return x.length === y.length && timingSafeEqual(x, y); };

/** The checkout's success post: order_id|payment_id signed with the key secret. */
export function razorpayPaymentSigned(keySecret: string, orderId: string, paymentId: string, signature: string) {
  return same(hmac(keySecret, `${orderId}|${paymentId}`), signature);
}

// Links the app makes itself (our checkout page and Razorpay's return), signed so they can't be altered.
function linkKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("server key missing");
  return createHmac("sha256", k).update("campustwin:razorpay-link").digest();
}
export const signLink = (publicId: string, ret: string) => createHmac("sha256", linkKey()).update(`${publicId}|${ret}`).digest("hex").slice(0, 32);
export const checkLink = (publicId: string, ret: string, sig: string) => same(signLink(publicId, ret), sig);
/** Only paths on this site (never another site) may be returned to. */
export const safeReturn = (ret: string) => (/^\/[A-Za-z0-9/_\-?=&.%]*$/.test(ret) && !ret.startsWith("//") ? ret : "/dashboard/fees");

export const razorpay: GatewayConnector = {
  id: "razorpay",
  label: "Razorpay",
  async checkout(order, ctx) {
    const keys = razorpayKeys(order);
    if (!keys) return { ok: false, error: "Online payment is being set up at your institution. Please pay at the office for now." };
    if ((order.mode === "test") !== keys.key_id.startsWith("rzp_test_")) return { ok: false, error: "Online payment is being set up at your institution. Please pay at the office for now." };
    let orderId = order.provider_order_id;
    if (!orderId) {
      const r = await razorpayApi<{ id: string }>(keys, "/orders", { method: "POST", body: {
        amount: Math.round(Number(order.amount) * 100), currency: order.currency || "INR", receipt: order.public_id.slice(0, 40),
        notes: { public_id: order.public_id, institution: order.school_name.slice(0, 200), student: order.student_name.slice(0, 200) },
      } });
      if (!r.ok) return { ok: false, error: r.status === 401 ? "Online payment is being set up at your institution. Please pay at the office for now." : "The payment could not be started. Please try again." };
      orderId = r.data.id;
    }
    const ret = safeReturn(new URL(ctx.returnUrl, ctx.origin).pathname);
    return { ok: true, providerOrderId: orderId, redirectUrl: `/pay/razorpay/${order.public_id}?r=${encodeURIComponent(ret)}&s=${signLink(order.public_id, ret)}` };
  },
  async webhook(request, lookup): Promise<WebhookOutcome> {
    const raw = await request.text();
    const body = JSON.parse(raw) as { event: string; payload: { payment?: { entity: RazorpayPayment }; order?: { entity: { id: string; receipt?: string; notes?: Record<string, string> } }; refund?: { entity: { id: string; amount: number; payment_id: string; notes?: Record<string, string> } } } };
    const pay = body.payload?.payment?.entity;
    const publicId = pay?.notes?.public_id ?? body.payload?.order?.entity?.notes?.public_id ?? body.payload?.order?.entity?.receipt ?? body.payload?.refund?.entity?.notes?.public_id;
    if (!publicId || !/^[a-f0-9]{24}$/.test(publicId)) return { kind: "ignored" };
    const order = await lookup(publicId);
    if (!order) return { kind: "ignored" };
    // the notice must be signed with this institution's webhook secret
    const keys = razorpayKeys(order);
    if (!keys?.webhook_secret || !same(hmac(keys.webhook_secret, raw), request.headers.get("x-razorpay-signature") ?? "")) throw new Error("bad signature");
    if ((body.event === "payment.captured" || body.event === "order.paid") && pay && pay.status === "captured") {
      if (order.provider_order_id && pay.order_id !== order.provider_order_id) return { kind: "ignored" };
      return { kind: "paid", publicId, paymentId: pay.id, amount: pay.amount / 100, providerOrderId: pay.order_id, method: pay.method,
        fee: pay.fee != null ? pay.fee / 100 : undefined, paidAt: pay.created_at ? new Date(pay.created_at * 1000).toISOString() : undefined };
    }
    if (body.event === "refund.processed" && body.payload?.refund?.entity) {
      const rf = body.payload.refund.entity;
      return { kind: "refund", publicId, amount: rf.amount / 100, ref: rf.id };
    }
    // a failed try can be followed by a successful one on the same order, so failures are not recorded here
    return { kind: "ignored" };
  },
};
