import { isFinance } from "@/lib/roles";
import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { headers } from "next/headers";
import { GatewayApplication, type PaymentProfile } from "@/components/settings/gateway-application";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { PaymentGateways, ResolvePayment, type GatewayRow } from "@/components/settings/payment-gateways";

type OrderRow = { id: number; created_at: string; amount: number; status: string; mode: string; provider: string; failure_reason: string | null;
  refund_due: number; refunded_amount: number; method: string | null; student: { full_name: string } | null; fee_payment: { receipt_no: string } | null };
const STATUS: Record<string, string> = { created: "Started", pending: "Bank processing", paid: "Paid", failed: "Failed", expired: "Abandoned", review: "Needs checking" };

// Settings → Online payment (office; principal sees the payments list).
export default async function PaymentSettingsPage() {
  const denied = await guardTab("/dashboard/settings/payments");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const [gwRes, ordRes, attRes] = await Promise.all([
    supabase.from("payment_gateway" as never).select("id, provider, label, mode, active, config, secret_id, updated_at").order("id"),
    supabase.from("payment_order" as never).select("id, created_at, amount, status, mode, provider, failure_reason, refund_due, refunded_amount, method, student:student_id(full_name), fee_payment:fee_payment_id(receipt_no)")
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("payment_order" as never).select("id, created_at, amount, status, mode, provider, failure_reason, refund_due, refunded_amount, method, student:student_id(full_name), fee_payment:fee_payment_id(receipt_no)")
      .or("status.eq.review,refund_due.gt.0").order("created_at").limit(500),
  ]);
  const gateways: GatewayRow[] = ((gwRes.data ?? []) as unknown as (Omit<GatewayRow, "hasKeys" | "merchantId"> & { secret_id: string | null; config: { merchant_id?: string; key_id?: string } })[])
    .map((g) => ({ id: g.id, provider: g.provider, label: g.label, mode: g.mode, active: g.active, hasKeys: !!g.secret_id, merchantId: g.config?.merchant_id ?? "", keyId: g.config?.key_id ?? "", updated_at: g.updated_at }));
  const host = (await headers()).get("host") ?? "";
  const site = `https://${host}`;
  const { data: prof } = isFinance(session) ? await supabase.from("payment_profile" as never).select("legal_name, entity_type, registration_no, gstin, pan_last4, contact_name, contact_phone, contact_email, address, expected_monthly, bank_holder, bank_ifsc, bank_last4, admission_refundable, refund_days, hostel_rule, transport_rule, extra_terms, grievance_name").maybeSingle() : { data: null };
  const orders = (ordRes.data ?? []) as unknown as OrderRow[];
  const attention = (attRes.data ?? []) as unknown as OrderRow[];
  const money = (v: number) => `Rs ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Online payment" description="Parents pay fees online into your own merchant account. Add your gateway and its keys; the receipt, the bill and Finance update by themselves." />
      {isFinance(session) && <PaymentGateways gateways={gateways} webhookBase={site} />}
      {isFinance(session) && <GatewayApplication profile={(prof ?? null) as unknown as PaymentProfile | null} site={site} school={{ name: session?.school.name ?? "", higherEd: !!session?.school.higherEd }} />}
      {attention.length > 0 && (
        <Card>
          <CardHeader title="Needs your attention" action={<span className="text-[12px] text-down">{attention.length}</span>} />
          <CardBody className="p-0">
            <ul>{attention.map((o) => (
              <li key={o.id} className="border-b border-hair px-4 py-2 text-[13px] last:border-b-0">
                <span className="font-medium">{o.student?.full_name}</span>, {money(o.amount)}: {o.failure_reason ?? "check this payment"}
                {Number(o.refund_due) > 0 && <span className="text-down"> · refund due {money(o.refund_due)}</span>}
                {isFinance(session) && <ResolvePayment orderId={o.id} />}
              </li>))}
            </ul>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Online payments" action={<span className="text-[12px] text-ink-500">Latest 100</span>} />
        <CardBody className="p-0">
          {orders.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No online payments yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#fafafa] text-left text-ink-500"><tr>
                  <th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Student</th><th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Receipt</th><th className="px-4 py-2 font-medium">Gateway</th>
                </tr></thead>
                <tbody>{orders.map((o) => (
                  <tr key={o.id} className="border-t border-hair">
                    <td className="whitespace-nowrap px-4 py-2">{new Date(o.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-2">{o.student?.full_name}</td>
                    <td className="px-4 py-2 text-right tabular">{money(o.amount)}</td>
                    <td className="px-4 py-2"><span className={o.status === "paid" ? "text-up" : o.status === "review" || o.status === "failed" ? "text-down" : "text-ink-700"}>{STATUS[o.status] ?? o.status}</span></td>
                    <td className="px-4 py-2">{o.fee_payment?.receipt_no ?? "-"}</td>
                    <td className="px-4 py-2">{o.provider}{o.mode === "test" ? " (test)" : ""}{o.method ? `, ${o.method}` : ""}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
