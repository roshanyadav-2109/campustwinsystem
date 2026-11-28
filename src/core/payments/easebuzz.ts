import "server-only";
import { createHash } from "node:crypto";
import { GATEWAY_FIELDS } from "@/core/payments/choices";
import type { HostedGateway, Verified } from "@/core/payments/hosted";
import { postForm } from "@/core/payments/hosted";

// Easebuzz hosted checkout, on the institution's own account.
//   config: { key }   secret: { salt }
// Spec: docs.easebuzz.in (checked 28 Nov 2026). We ask Easebuzz for an access key, send the payer to its page, and
// read the result from its Transaction API (v2.1) with the institution's salt; what comes back with the payer is ignored.
const sha512 = (s: string) => createHash("sha512").update(s).digest("hex");
const payBase = (mode: string) => (mode === "test" ? "https://testpay.easebuzz.in" : "https://pay.easebuzz.in");
const dashBase = (mode: string) => (mode === "test" ? "https://testdashboard.easebuzz.in" : "https://dashboard.easebuzz.in");
const clean = (s: string, n: number) => s.replace(/[^A-Za-z0-9 .@_-]/g, "").trim().slice(0, n);

type Txn = { status?: string; easepayid?: string; amount?: string; mode?: string; error_Message?: string; addedon?: string; txnid?: string };
async function retrieve(mode: string, key: string, salt: string, txnid: string) {
  const r = await postForm(`${dashBase(mode)}/transaction/v2.1/retrieve`, { key, txnid, hash: sha512(`${key}|${txnid}|${salt}`) });
  if (!r.ok) return null;
  try { return JSON.parse(r.text) as { status?: boolean; msg?: Txn[] | string }; } catch { return null; }
}

export const easebuzz: HostedGateway = {
  id: "easebuzz",
  label: "Easebuzz",
  fields: GATEWAY_FIELDS.easebuzz,
  async start(order, keys, ctx) {
    const key = keys.config.key, salt = keys.secret.salt;
    const f = {
      key, txnid: order.public_id, amount: Number(order.amount).toFixed(2),
      productinfo: clean(`Fees ${order.student_name}`, 45) || "Fees", firstname: clean(order.payer_name ?? order.student_name, 150) || "Payer",
      email: (order.payer_email ?? "").trim().slice(0, 200) || "noreply@campustwin.org",
      phone: (() => { const d = (order.payer_phone ?? "").replace(/\D/g, "").slice(-10); return d.length === 10 ? d : "9999999999"; })(),
      surl: ctx.callbackUrl, furl: ctx.callbackUrl,
    };
    const hash = sha512([f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, "", "", "", "", "", "", "", "", "", "", salt].join("|"));
    const r = await postForm(`${payBase(order.mode)}/payment/initiateLink`, { ...f, hash });
    let j: { status?: number; data?: string; error_desc?: string } = {};
    try { j = JSON.parse(r.text); } catch { j = {}; }
    if (j.status !== 1 || !j.data || !/^[A-Za-z0-9]+$/.test(j.data)) return { ok: false, error: "The payment could not be started. Please try again, or pay at the office." };
    return { ok: true, step: { kind: "redirect", url: `${payBase(order.mode)}/pay/${j.data}` } };
  },
  async verify(order, keys): Promise<Verified> {
    const j = await retrieve(order.mode, keys.config.key, keys.secret.salt, order.public_id);
    if (!j || j.status !== true || !Array.isArray(j.msg)) return j && j.status === false ? { status: "failed", reason: "The payment was not completed" } : { status: "unknown" };
    const t = j.msg.find((x) => x.txnid === order.public_id);
    if (!t) return { status: "unknown" };
    if (t.status === "success" && t.easepayid && Number.isFinite(Number(t.amount)))
      return { status: "paid", paymentId: t.easepayid, amount: Number(t.amount), method: t.mode?.toLowerCase(), paidAt: t.addedon ? new Date(`${t.addedon.replace(" ", "T")}+05:30`).toISOString() : undefined };
    if (t.status === "pending" || t.status === "initiated") return { status: "pending" };
    if (["failure", "userCancelled", "dropped", "bounced"].includes(t.status ?? ""))
      return { status: "failed", reason: t.error_Message || "The payment did not go through" };
    return { status: "unknown" };
  },
  noticeOrderId(raw) {
    try { return new URLSearchParams(raw).get("txnid"); } catch { return null; }
  },
  async test(keys, mode) {
    // the status API answers "not found" even for wrong keys, so a Rs 1 link is asked for instead: it checks the key
    // and the salt (hash), and simply expires unused after 15 minutes
    const key = keys.config.key, salt = keys.secret.salt;
    const f = { key, txnid: `ctcheck${Date.now()}`, amount: "1.00", productinfo: "Connection check", firstname: "CampusTwin", email: "noreply@campustwin.org", phone: "9999999999", surl: "https://campustwin.org/", furl: "https://campustwin.org/" };
    const hash = sha512([f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, "", "", "", "", "", "", "", "", "", "", salt].join("|"));
    const r = await postForm(`${payBase(mode)}/payment/initiateLink`, { ...f, hash });
    let j: { status?: number; error_desc?: string } = {};
    try { j = JSON.parse(r.text); } catch { return { ok: false, error: "Easebuzz could not be reached. Try again shortly." }; }
    return j.status === 1 ? { ok: true } : { ok: false, error: `Easebuzz did not accept these keys${j.error_desc ? ` (${j.error_desc})` : ""}. Check the key, salt and test or live mode.` };
  },
};
