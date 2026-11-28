import "server-only";
import { GATEWAY_FIELDS } from "@/core/payments/choices";
import { createHash, timingSafeEqual } from "node:crypto";
import type { HostedGateway, Verified } from "@/core/payments/hosted";
import { postForm } from "@/core/payments/hosted";

// PayU India hosted checkout, on the institution's own account.
//   config: { key }   secret: { salt }  (the 32-character "Salt v1")
// Spec: docs.payu.in (checked 28 Nov 2026). The payer posts our signed form to PayU; whatever comes back is only a
// signal: the result is read from PayU's verify_payment API with the institution's salt.
const sha512 = (s: string) => createHash("sha512").update(s).digest("hex");
const payURL = (mode: string) => (mode === "test" ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment");
const apiURL = (mode: string) => (mode === "test" ? "https://test.payu.in/merchant/postservice.php?form=2" : "https://info.payu.in/merchant/postservice.php?form=2");
const clean = (s: string, n: number) => s.replace(/[^A-Za-z0-9 .@_-]/g, "").trim().slice(0, n);

type Txn = { status?: string; unmappedstatus?: string; amt?: string; mihpayid?: string; mode?: string; error_Message?: string; addedon?: string; net_amount_debit?: string };
async function verifyTxn(mode: string, key: string, salt: string, txnid: string) {
  const command = "verify_payment";
  const r = await postForm(apiURL(mode), { key, command, var1: txnid, hash: sha512(`${key}|${command}|${txnid}|${salt}`) });
  if (!r.ok) { console.log("payu verify http", r.status); return { http: r.status } as { status?: number; msg?: string; http?: number; transaction_details?: Record<string, Txn> }; }
  try { return JSON.parse(r.text) as { status?: number; msg?: string; http?: number; transaction_details?: Record<string, Txn> }; } catch { return { http: r.status } as { status?: number; msg?: string; http?: number; transaction_details?: Record<string, Txn> }; }
}

export const payu: HostedGateway = {
  id: "payu",
  label: "PayU",
  fields: GATEWAY_FIELDS.payu,
  async start(order, keys, ctx) {
    const key = keys.config.key, salt = keys.secret.salt;
    const txnid = order.public_id;                       // 24 characters (PayU allows 25)
    const amount = Number(order.amount).toFixed(2);
    const productinfo = clean(`Fees ${order.student_name}`, 100) || "Fees";
    const firstname = clean(order.payer_name ?? order.student_name, 60) || "Payer";
    const email = (order.payer_email ?? "").slice(0, 50) || "noreply@campustwin.org";
    const udf = ["", "", "", "", ""];
    const hash = sha512([key, txnid, amount, productinfo, firstname, email, ...udf, "", "", "", "", "", salt].join("|"));
    return { ok: true, step: { kind: "post", action: payURL(order.mode), fields: {
      key, txnid, amount, productinfo, firstname, email, phone: (order.payer_phone ?? "").replace(/\D/g, "").slice(-10),
      surl: ctx.callbackUrl, furl: ctx.callbackUrl, curl: ctx.callbackUrl, udf1: "", udf2: "", udf3: "", udf4: "", udf5: "", hash,
    } } };
  },
  async verify(order, keys): Promise<Verified> {
    const j = await verifyTxn(order.mode, keys.config.key, keys.secret.salt, order.public_id);
    if (!j || j.status !== 1) return { status: "unknown" };
    const t = j.transaction_details?.[order.public_id];
    if (!t) return { status: "unknown" };
    if (t.status === "success" && t.unmappedstatus === "captured" && t.mihpayid && Number.isFinite(Number(t.amt)))
      return { status: "paid", paymentId: t.mihpayid, amount: Number(t.amt), method: t.mode?.toLowerCase(), paidAt: t.addedon ? new Date(`${t.addedon.replace(" ", "T")}+05:30`).toISOString() : undefined };
    if (t.status === "pending" || t.unmappedstatus === "pending" || t.unmappedstatus === "auth") return { status: "pending" };
    if (t.status === "Not Found") return { status: "failed", reason: "The payment was not completed" };
    if (t.status === "failure" || ["failed", "dropped", "bounced", "usercancelled"].includes(t.unmappedstatus ?? ""))
      return { status: "failed", reason: t.error_Message && t.error_Message !== "NO ERROR" ? t.error_Message : "The payment did not go through" };
    return { status: "unknown" };
  },
  // PayU signs what it posts with the institution's salt (docs.payu.in, "Generate Hash", response hash):
  //   sha512([additional_charges|]SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
  // A paid result counts only if that hash matches, it is for this order and this key, and the amount is the bill's.
  verifyPosted(order, keys, p): Verified {
    const g = (k: string) => p.get(k) ?? "";
    if (g("txnid") !== order.public_id || g("key") !== keys.config.key || !g("hash")) return { status: "unknown" };
    const extra = g("additional_charges") || g("additionalCharges");
    if (extra && !/^\d+(\.\d+)?$/.test(extra)) return { status: "unknown" };
    const parts = [keys.secret.salt, g("status"), "", "", "", "", "", g("udf5"), g("udf4"), g("udf3"), g("udf2"), g("udf1"), g("email"), g("firstname"), g("productinfo"), g("amount"), g("txnid"), g("key")];
    const want = sha512((extra ? [extra, ...parts] : parts).join("|"));
    const a = Buffer.from(want), b = Buffer.from(g("hash").toLowerCase());
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { status: "unknown" };
    if (g("status") === "success" && g("mihpayid")) {
      if (Number(g("amount")).toFixed(2) !== Number(order.amount).toFixed(2)) return { status: "unknown" };
      return { status: "paid", paymentId: g("mihpayid"), amount: Number(g("amount")), method: g("mode").toLowerCase() || undefined };
    }
    if (g("status") === "pending") return { status: "pending" };
    if (g("status") === "failure") return { status: "failed", reason: g("error_Message") && g("error_Message") !== "NO ERROR" ? g("error_Message") : "The payment did not go through" };
    return { status: "unknown" };
  },
  noticeOrderId(raw, type) {
    try { return type.includes("json") ? (JSON.parse(raw) as { txnid?: string; merchantTxnId?: string }).txnid ?? null : new URLSearchParams(raw).get("txnid"); } catch { return null; }
  },
  async test(keys, mode) {
    const j = await verifyTxn(mode, keys.config.key, keys.secret.salt, "campustwincheck");
    if (j && j.status === 1) return { ok: true };
    // PayU's status servers refuse our hosting's addresses; the keys can't be checked from here, and payments are then
    // confirmed by PayU's salt-signed result instead
    if (j?.http === 403) return { ok: true, note: "Keys saved. PayU's servers don't accept checks from our hosting, so make one small test payment to confirm them; each payment is confirmed by PayU's signed result." };
    if (j?.http !== undefined) return { ok: false, error: `PayU could not be reached (answer ${j.http}). Try again shortly.` };
    return { ok: false, error: j ? `PayU did not accept these keys (${j.msg ?? "check the key and salt"}). Check test or live mode too.` : "PayU could not be reached. Try again shortly." };
  },
};
