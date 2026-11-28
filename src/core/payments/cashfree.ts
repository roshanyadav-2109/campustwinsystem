import "server-only";
import { GATEWAY_FIELDS } from "@/core/payments/choices";
import type { HostedGateway, Keys, Verified } from "@/core/payments/hosted";
import type { GatewayOrder } from "@/core/payments/gateways";

// Cashfree Payments (Orders API + JS checkout), on the institution's own account.
//   config: { app_id }   secret: { secret_key }
// Spec: cashfree.com/docs (checked 28 Nov 2026). Our payment id is Cashfree's order_id; a payment counts only when
// Cashfree's own API says a payment of that order is SUCCESS.
const VERSION = "2026-01-01";
const base = (mode: string) => (mode === "test" ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg");

async function cf<T>(mode: string, keys: Keys, path: string, init?: { method?: string; body?: unknown; idem?: string }): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const r = await fetch(`${base(mode)}${path}`, {
      method: init?.method ?? "GET",
      headers: { "x-client-id": keys.config.app_id, "x-client-secret": keys.secret.secret_key, "x-api-version": VERSION, Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.idem ? { "x-idempotency-key": init.idem } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const j = (await r.json().catch(() => ({}))) as T & { message?: string };
    return r.ok ? { ok: true, data: j } : { ok: false, status: r.status, error: (j as { message?: string }).message ?? `Cashfree answered ${r.status}` };
  } catch { return { ok: false, status: 0, error: "Cashfree could not be reached" }; }
}

const phone = (o: GatewayOrder) => { const d = (o.payer_phone ?? "").replace(/\D/g, "").slice(-10); return d.length === 10 ? d : "9999999999"; };

export const cashfree: HostedGateway = {
  id: "cashfree",
  label: "Cashfree",
  fields: GATEWAY_FIELDS.cashfree,
  async start(order, keys, ctx) {
    if (ctx.callbackUrl.length > 250) return { ok: false, error: "The payment could not be started. Please pay at the office." };
    type O = { payment_session_id: string; order_status: string; cf_order_id: string | number };
    // the same order is reused if it already exists at Cashfree (a second click, another tab)
    let o = await cf<O>(order.mode, keys, `/orders/${order.public_id}`);
    if (!o.ok && o.status === 404) {
      o = await cf<O>(order.mode, keys, "/orders", { method: "POST", idem: order.public_id, body: {
        order_id: order.public_id, order_amount: Math.round(Number(order.amount) * 100) / 100, order_currency: order.currency || "INR",
        customer_details: { customer_id: `p${order.public_id}`, customer_phone: phone(order), ...(order.payer_name && order.payer_name.length >= 3 ? { customer_name: order.payer_name.slice(0, 100) } : {}), ...(order.payer_email ? { customer_email: order.payer_email.slice(0, 100) } : {}) },
        order_meta: { return_url: ctx.callbackUrl, notify_url: `${ctx.origin}/api/payments/webhook/cashfree` },
        order_expiry_time: new Date(Math.max(new Date(order.expires_at).getTime(), Date.now() + 16 * 60 * 1000)).toISOString(),
        order_note: `Payment for ${order.student_name}`.slice(0, 200).padEnd(3, "."),
      } });
    }
    if (!o.ok) return { ok: false, error: o.status === 401 ? "Online payment is being set up at your institution. Please pay at the office for now." : "The payment could not be started. Please try again." };
    if (o.data.order_status === "PAID") return { ok: false, error: "This payment is already complete." };
    if (!o.data.payment_session_id || o.data.order_status !== "ACTIVE") return { ok: false, error: "This payment link has expired. Please start the payment again from Fees." };
    return { ok: true, providerOrderId: String(o.data.cf_order_id), step: { kind: "cashfree", sessionId: o.data.payment_session_id, mode: order.mode === "test" ? "sandbox" : "production" } };
  },
  async verify(order, keys): Promise<Verified> {
    const r = await cf<{ cf_payment_id: string | number; payment_status: string; payment_amount: number; payment_group?: string; payment_completion_time?: string; payment_message?: string }[]>(order.mode, keys, `/orders/${order.public_id}/payments`);
    if (!r.ok) return r.status === 404 ? { status: "failed", reason: "The payment was not started at Cashfree" } : { status: "unknown" };
    const list = Array.isArray(r.data) ? r.data : [];
    const ok = list.find((p) => p.payment_status === "SUCCESS");
    if (ok && Number.isFinite(Number(ok.payment_amount))) return { status: "paid", paymentId: String(ok.cf_payment_id), amount: Number(ok.payment_amount), method: ok.payment_group, paidAt: ok.payment_completion_time };
    if (list.some((p) => p.payment_status === "PENDING")) return { status: "pending" };
    const last = list[0];
    if (last && ["FAILED", "USER_DROPPED", "CANCELLED", "VOID"].includes(last.payment_status)) return { status: "failed", reason: last.payment_message || (last.payment_status === "USER_DROPPED" ? "The payment was not completed" : "The payment did not go through") };
    return list.length ? { status: "unknown" } : { status: "failed", reason: "The payment was not completed" };
  },
  noticeOrderId(raw) {
    try { return (JSON.parse(raw) as { data?: { order?: { order_id?: string } } }).data?.order?.order_id ?? null; } catch { return null; }
  },
  async test(keys, mode) {
    // asking for an order that doesn't exist: 404 means the keys were accepted, 401 that they were not
    const r = await cf(mode, keys, "/orders/campustwin_connection_check");
    if (r.ok || r.status === 404) return { ok: true };
    return { ok: false, error: r.status === 401 ? "Cashfree did not accept these keys. Check the App ID and Secret key (and test or live mode)." : `Cashfree could not be reached (${r.error}).` };
  },
};
