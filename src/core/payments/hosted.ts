import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayConnector, GatewayOrder, WebhookOutcome } from "@/core/payments/gateways";

// Gateways where the payer goes to the gateway's own page (PayU, Easebuzz, CCAvenue, Cashfree).
// Each one only says: which keys it needs, how to send the payer, and how to ask the gateway what happened.
// We never trust what comes back through the browser or a notice: the result is always read from the gateway's
// own status API with the institution's keys, and the database records it once (complete_payment_order).

export type KeyField = { name: string; label: string; secret: boolean; hint?: string; pattern?: string };
export type Step =
  | { kind: "post"; action: string; fields: Record<string, string> }       // an auto-submitted form to the gateway
  | { kind: "redirect"; url: string }                                       // straight to the gateway's page
  | { kind: "cashfree"; sessionId: string; mode: "sandbox" | "production" }; // Cashfree's own script
export type Verified =
  | { status: "paid"; paymentId: string; amount: number; method?: string; fee?: number; paidAt?: string; providerOrderId?: string }
  | { status: "failed"; reason: string }
  | { status: "pending" }
  | { status: "unknown" };
export type Keys = { config: Record<string, string>; secret: Record<string, string> };

export interface HostedGateway {
  id: string;
  label: string;
  fields: KeyField[];
  /** Start: where to send the payer (may call the gateway to make an order). */
  start(order: GatewayOrder, keys: Keys, ctx: { callbackUrl: string; origin: string }): Promise<{ ok: true; step: Step; providerOrderId?: string } | { ok: false; error: string }>;
  /** Ask the gateway what happened to this order (its own status API). */
  verify(order: GatewayOrder, keys: Keys): Promise<Verified>;
  /** From a notice, the order it is about (the notice itself is not trusted; verify() is). */
  noticeOrderId?(raw: string, contentType: string): string | null;
  /** Check that the keys work (changes nothing at the gateway). */
  test?(keys: Keys, mode: "live" | "test"): Promise<{ ok: true } | { ok: false; error: string }>;
}

export function keysOf(o: Pick<GatewayOrder, "config" | "secret">, fields: KeyField[]): Keys | null {
  let secret: Record<string, string> = {};
  try { secret = o.secret ? JSON.parse(o.secret) : {}; } catch { return null; }
  const config = Object.fromEntries(Object.entries(o.config ?? {}).map(([k, v]) => [k, String(v ?? "")]));
  for (const f of fields) if (!(f.secret ? secret[f.name] : config[f.name])) return null;
  return { config, secret };
}

// Links the app makes itself (the checkout page and the gateway's return), signed so they can't be altered.
function linkKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("server key missing");
  return createHmac("sha256", k).update("campustwin:hosted-link").digest();
}
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b ?? ""); return x.length === y.length && timingSafeEqual(x, y); };
export const signHosted = (publicId: string, ret: string) => createHmac("sha256", linkKey()).update(`${publicId}|${ret}`).digest("hex").slice(0, 32);
export const checkHosted = (publicId: string, ret: string, sig: string) => same(signHosted(publicId, ret), sig);
export const safePath = (ret: string) => (/^\/[A-Za-z0-9/_\-?=&.%]*$/.test(ret) && !ret.startsWith("//") ? ret : "/dashboard/fees");
export const callbackFor = (origin: string, provider: string, publicId: string, ret: string) =>
  `${origin}/api/payments/return/${provider}?o=${publicId}&r=${encodeURIComponent(ret)}&s=${signHosted(publicId, ret)}`;

/** Turns a hosted gateway into a connector: checkout goes through our page; notices only trigger a re-check. */
export function hostedConnector(g: HostedGateway): GatewayConnector {
  return {
    id: g.id,
    label: g.label,
    async checkout(order, ctx) {
      if (!keysOf(order, g.fields)) return { ok: false, error: "Online payment is being set up at your institution. Please pay at the office for now." };
      const ret = safePath(new URL(ctx.returnUrl, ctx.origin).pathname);
      return { ok: true, redirectUrl: `/pay/go/${order.public_id}?r=${encodeURIComponent(ret)}&s=${signHosted(order.public_id, ret)}` };
    },
    async webhook(request, lookup): Promise<WebhookOutcome> {
      const raw = await request.text();
      const id = g.noticeOrderId?.(raw, request.headers.get("content-type") ?? "") ?? null;
      if (!id || !/^[a-f0-9]{24}$/.test(id)) return { kind: "ignored" };
      const order = await lookup(id);
      const keys = order ? keysOf(order, g.fields) : null;
      if (!order || !keys) return { kind: "ignored" };
      const v = await g.verify(order, keys);
      if (v.status === "paid") return { kind: "paid", publicId: id, paymentId: v.paymentId, amount: v.amount, method: v.method, fee: v.fee, paidAt: v.paidAt, providerOrderId: v.providerOrderId };
      if (v.status === "failed") return { kind: "failed", publicId: id, reason: v.reason };
      return { kind: "ignored" };
    },
  };
}

/** Record what the gateway says (used by the return, the payer's result page and the office's "check again"). */
export async function recordVerified(admin: { rpc: (fn: never, args: never) => PromiseLike<{ error: { message: string; code?: string } | null }> }, order: GatewayOrder, v: Verified) {
  if (v.status === "paid") {
    const { error } = await admin.rpc("complete_payment_order" as never, {
      p_public_id: order.public_id, p_provider_payment_id: v.paymentId, p_amount: v.amount, p_provider_order_id: v.providerOrderId ?? null,
      p_paid_at: v.paidAt ?? null, p_method: v.method ?? null, p_gateway_fee: v.fee ?? null,
    } as never);
    return !error || error.code === "23505";
  }
  if (v.status === "failed" && order.status === "created") {
    await admin.rpc("fail_payment_order" as never, { p_public_id: order.public_id, p_reason: v.reason.slice(0, 200) } as never);
    return true;
  }
  if (v.status === "pending") {
    await admin.rpc("mark_payment_pending" as never, { p_public_id: order.public_id, p_note: "Waiting for the bank's confirmation" } as never);
    return true;
  }
  return false;
}

export async function postForm(url: string, body: Record<string, string>): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(body).toString() });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch { return { ok: false, status: 0, text: "" }; }
}
