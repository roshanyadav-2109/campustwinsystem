import Link from "@/components/ui/hover-link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/fees/auto-refresh";

// Where the payer lands after the gateway: what happened to this payment.
export const dynamic = "force-dynamic";
export default async function PaymentResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = /^[a-f0-9]{24}$/.test(id)
    ? await supabase.from("payment_order" as never).select("amount, status, mode, failure_reason, credited_amount, refund_due, fee_payment:fee_payment_id(receipt_no)").eq("public_id", id).maybeSingle()
    : { data: null };
  const o = data as unknown as { amount: number; status: string; mode: string; failure_reason: string | null; credited_amount: number | null; refund_due: number; fee_payment: { receipt_no: string } | null } | null;
  const money = (v: number | null) => `Rs ${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const view = !o ? { title: "Payment not found", text: "We could not find this payment.", tone: "text-ink-900" }
    : o.status === "paid" ? { title: "Payment received", text: `${money(o.credited_amount)} was paid${o.fee_payment ? `. Receipt ${o.fee_payment.receipt_no}` : ""}.${Number(o.refund_due) > 0 ? ` ${money(o.refund_due)} more than the bill arrived; the school will refund it.` : ""}${o.mode === "test" ? " (Test payment: no money moved.)" : ""}`, tone: "text-up" }
    : o.status === "pending" ? { title: "Payment being processed", text: "Your bank has not confirmed it yet. You do not need to pay again; this page and your receipts update when it is confirmed.", tone: "text-ink-900" }
    : o.status === "review" ? { title: "Payment received, being checked", text: "The school will check this payment and contact you if anything is needed. Please do not pay again.", tone: "text-ink-900" }
    : o.status === "created" ? { title: "Payment not finished", text: "The payment was not completed. You can try again from Fees.", tone: "text-ink-900" }
    : { title: "Payment not completed", text: `${o.failure_reason ?? "The payment did not go through."} No money was taken. You can try again from Fees.`, tone: "text-down" };
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Online payment" />
      <div className="rounded-md border border-hair bg-white p-6">
        <h1 className={`text-[20px] font-semibold ${view.tone}`}>{view.title}</h1>
        <p className="mt-2 text-[14px] text-ink-700">{view.text}</p>
        {o?.status === "paid" && o.fee_payment && <p className="mt-2 text-[13px] text-ink-500">Download the receipt from Fees, Payment history.</p>}
        {o?.status === "pending" && <AutoRefresh seconds={10} />}
        <Link href="/dashboard/fees" className="mt-5 inline-block text-[14px] font-medium text-[#0F6CBD] hover:underline">Back to Fees</Link>
      </div>
    </div>
  );
}
