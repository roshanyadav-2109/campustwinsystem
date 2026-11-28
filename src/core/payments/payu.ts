import "server-only";
import { GATEWAY_FIELDS } from "@/core/payments/choices";
import { createHash } from "node:crypto";
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
  if (!r.ok) return null;
  try { return JSON.parse(r.text) as { status?: number; msg?: string; transaction_details?: Record<string, Txn> }; } catch { return null; }
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
    if (t.status === "success" && t.unmappedstatus === "captured" && t.mihpayid)
      return { status: "paid", paymentId: t.mihpayid, amount: Number(t.amt), method: t.mode?.toLowerCase(), paidAt: t.addedon ? new Date(`${t.addedon.replace(" ", "T")}+05:30`).toISOString() : undefined };
    if (t.status === "pending" || t.unmappedstatus === "pending" || t.unmappedstatus === "auth") return { status: "pending" };
    if (t.status === "Not Found") return { status: "failed", reason: "The payment was not completed" };
    if (t.status === "failure" || ["failed", "dropped", "bounced", "usercancelled"].includes(t.unmappedstatus ?? ""))
      return { status: "failed", reason: t.error_Message && t.error_Message !== "NO ERROR" ? t.error_Message : "The payment did not go through" };
    return { status: "unknown" };
  },
  noticeOrderId(raw, type) {
    try { return type.includes("json") ? (JSON.parse(raw) as { txnid?: string; merchantTxnId?: string }).txnid ?? null : new URLSearchParams(raw).get("txnid"); } catch { return null; }
  },
  async test(keys, mode) {
    const j = await verifyTxn(mode, keys.config.key, keys.secret.salt, "campustwincheck");
    if (j && j.status === 1) return { ok: true };
    return { ok: false, error: j ? `PayU did not accept these keys (${j.msg ?? "check the key and salt"}). Check test or live mode too.` : "PayU could not be reached. Try again shortly." };
  },
};
