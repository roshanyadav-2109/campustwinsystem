"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { savePaymentProfile } from "@/app/dashboard/settings/payments/actions";

export type PaymentProfile = {
  legal_name: string | null; entity_type: string | null; registration_no: string | null; gstin: string | null; pan_last4: string | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null; address: string | null; expected_monthly: number | null;
  bank_holder: string | null; bank_ifsc: string | null; bank_last4: string | null; admission_refundable: boolean; refund_days: number;
  hostel_rule: string | null; transport_rule: string | null; extra_terms: string | null; grievance_name: string | null;
};
const ENTITY: [string, string][] = [["trust", "Trust"], ["society", "Society"], ["section8", "Section 8 company"], ["company", "Private / public company"], ["government", "Government / aided"], ["partnership", "Partnership"], ["proprietor", "Proprietorship"], ["other", "Other"]];

function Copy({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-hair py-1.5 text-[13px] first:border-0">
      <span className="w-48 shrink-0 text-ink-500">{label}</span>
      <span className="min-w-0 flex-1 break-all text-ink-900">{value || <span className="text-ink-500">Not filled yet</span>}</span>
      {value && <button type="button" className="text-[12px] text-[#0F6CBD] hover:underline" onClick={() => { void navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? "Copied" : "Copy"}</button>}
    </div>
  );
}

// The gateway application: everything Razorpay (or another gateway) asks when the institution applies for a merchant
// account, kept in one place; the policy pages the gateway checks are made from it. PAN and bank account number are
// kept in the vault: only their last four digits are shown again.
export function GatewayApplication({ profile, site, school }: { profile: PaymentProfile | null; site: string; school: { name: string; higherEd: boolean } }) {
  const uid = useId();
  const p = profile;
  const [f, setF] = useState({
    legal_name: p?.legal_name ?? "", entity_type: p?.entity_type ?? "", registration_no: p?.registration_no ?? "", gstin: p?.gstin ?? "",
    contact_name: p?.contact_name ?? "", contact_phone: p?.contact_phone ?? "", contact_email: p?.contact_email ?? "", address: p?.address ?? "",
    expected_monthly: p?.expected_monthly != null ? String(Number(p.expected_monthly)) : "", bank_holder: p?.bank_holder ?? "", bank_ifsc: p?.bank_ifsc ?? "",
    admission_refundable: p?.admission_refundable ?? false, refund_days: String(p?.refund_days ?? 15),
    hostel_rule: p?.hostel_rule ?? "", transport_rule: p?.transport_rule ?? "", extra_terms: p?.extra_terms ?? "", grievance_name: p?.grievance_name ?? "",
  });
  const [pan, setPan] = useState("");
  const [acc, setAcc] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const links = { privacy: `${site}/policies/privacy`, terms: `${site}/policies/terms`, refund: `${site}/policies/refund`, contact: `${site}/policies/contact`, about: `${site}/policies/about` };
  return (
    <Card>
      <CardHeader title="Gateway application" action={<span className="text-[12px] text-ink-500">What the gateway asks when you apply</span>} />
      <CardBody className="space-y-5">
        <p className="text-[13px] text-ink-700">Fill this once. Your policy pages are made from it, and the panel below has everything ready to copy into the gateway&apos;s application. The PAN and the bank account number are stored encrypted; only their last four digits are shown again.</p>
        <section className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink-900">The institution</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Legal name (as on PAN / registration)" htmlFor={`${uid}-ln`} hint={`For example the trust or society that runs ${school.name || "the institution"}.`}><Input id={`${uid}-ln`} value={f.legal_name} onChange={set("legal_name")} /></Field>
            <Field label="Type of organisation" htmlFor={`${uid}-et`}><Select id={`${uid}-et`} value={f.entity_type} onChange={set("entity_type")}><option value="">Choose</option>{ENTITY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Registration number" htmlFor={`${uid}-rn`}><Input id={`${uid}-rn`} value={f.registration_no} onChange={set("registration_no")} /></Field>
            <Field label="GSTIN (if registered)" htmlFor={`${uid}-gst`}><Input id={`${uid}-gst`} value={f.gstin} onChange={set("gstin")} /></Field>
            <Field label={p?.pan_last4 ? `PAN (saved: ******${p.pan_last4}; enter to replace)` : "PAN of the organisation"} htmlFor={`${uid}-pan`}><Input id={`${uid}-pan`} type="password" autoComplete="off" value={pan} onChange={(e) => setPan(e.target.value)} /></Field>
            <Field label="Fees collected online in a month (approx., Rs)" htmlFor={`${uid}-em`}><Input id={`${uid}-em`} inputMode="numeric" value={f.expected_monthly} onChange={set("expected_monthly")} /></Field>
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink-900">Contact (shown on your Contact page)</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Contact person" htmlFor={`${uid}-cn`}><Input id={`${uid}-cn`} value={f.contact_name} onChange={set("contact_name")} /></Field>
            <Field label="Phone" htmlFor={`${uid}-cp`}><Input id={`${uid}-cp`} value={f.contact_phone} onChange={set("contact_phone")} /></Field>
            <Field label="Email" htmlFor={`${uid}-ce`}><Input id={`${uid}-ce`} type="email" value={f.contact_email} onChange={set("contact_email")} /></Field>
          </div>
          <Field label="Registered address" htmlFor={`${uid}-ad`}><Textarea id={`${uid}-ad`} rows={2} value={f.address} onChange={set("address")} /></Field>
          <Field label="Grievance officer (name)" htmlFor={`${uid}-gn`} hint="Shown on the privacy and refund pages; payment complaints go to them."><Input id={`${uid}-gn`} value={f.grievance_name} onChange={set("grievance_name")} /></Field>
        </section>
        <section className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink-900">Settlement bank account (where the gateway pays the money)</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Account holder name" htmlFor={`${uid}-bh`}><Input id={`${uid}-bh`} value={f.bank_holder} onChange={set("bank_holder")} /></Field>
            <Field label={p?.bank_last4 ? `Account number (saved: ****${p.bank_last4}; enter to replace)` : "Account number"} htmlFor={`${uid}-ba`}><Input id={`${uid}-ba`} type="password" autoComplete="off" inputMode="numeric" value={acc} onChange={(e) => setAcc(e.target.value)} /></Field>
            <Field label="IFSC" htmlFor={`${uid}-if`}><Input id={`${uid}-if`} value={f.bank_ifsc} onChange={set("bank_ifsc")} /></Field>
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink-900">Refunds (shown on your Refund and Cancellation page)</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Admission / registration fee" htmlFor={`${uid}-ar`}><Select id={`${uid}-ar`} value={f.admission_refundable ? "yes" : "no"} onChange={(e) => setF({ ...f, admission_refundable: e.target.value === "yes" })}><option value="no">Not refundable</option><option value="yes">Refundable</option></Select></Field>
            <Field label="Refunds reach the payer within (days)" htmlFor={`${uid}-rd`}><Input id={`${uid}-rd`} inputMode="numeric" value={f.refund_days} onChange={set("refund_days")} /></Field>
            <Field label="Hostel fees (optional)" htmlFor={`${uid}-hr`}><Input id={`${uid}-hr`} placeholder="For example: refunded for the months not stayed, after one month's notice" value={f.hostel_rule} onChange={set("hostel_rule")} /></Field>
            <Field label="Transport fees (optional)" htmlFor={`${uid}-tr`}><Input id={`${uid}-tr`} placeholder="For example: refunded for the months not used" value={f.transport_rule} onChange={set("transport_rule")} /></Field>
          </div>
          <Field label="Anything else to add to the terms (optional)" htmlFor={`${uid}-xt`}><Textarea id={`${uid}-xt`} rows={2} value={f.extra_terms} onChange={set("extra_terms")} /></Field>
        </section>
        <div className="flex items-center gap-3">
          <Button disabled={pending} onClick={() => start(async () => { const r = await savePaymentProfile(f, pan, acc); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) { setPan(""); setAcc(""); router.refresh(); } })}>Save</Button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
        </div>
        <section className="rounded-md border border-hair p-3">
          <h3 className="text-[13px] font-semibold text-ink-900">Ready to copy into the gateway&apos;s application</h3>
          <div className="mt-2">
            <Copy label="Business name" value={f.legal_name} />
            <Copy label="Brand name" value={school.name} />
            <Copy label="Business category" value={school.higherEd ? "Education: colleges and universities" : "Education: schools"} />
            <Copy label="Website" value={site} />
            <Copy label="About us" value={links.about} />
            <Copy label="Contact us" value={links.contact} />
            <Copy label="Privacy policy" value={links.privacy} />
            <Copy label="Terms and conditions" value={links.terms} />
            <Copy label="Refund and cancellation policy" value={links.refund} />
            <Copy label="Webhook URL (Razorpay)" value={`${site}/api/payments/webhook/razorpay`} />
            <Copy label="Business PAN" value={p?.pan_last4 ? `ending ${p.pan_last4} (type the full PAN in the gateway)` : ""} />
            <Copy label="Settlement account" value={p?.bank_last4 ? `${f.bank_holder || ""}, ****${p.bank_last4}, ${f.bank_ifsc}` : ""} />
          </div>
          <p className="mt-2 text-[12px] text-ink-500">The gateway also asks for documents (PAN card, registration certificate, a cancelled cheque or bank statement, and the authorised signatory&apos;s ID). Upload those on the gateway&apos;s own site; CampusTwin does not keep them.</p>
        </section>
      </CardBody>
    </Card>
  );
}
