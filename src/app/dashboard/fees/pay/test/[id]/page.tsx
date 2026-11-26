import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkTestOrder } from "@/core/payments/gateways";
import { finishTestPayment } from "@/app/dashboard/fees/pay/actions";

// The built-in test gateway: what a real gateway's payment page would be.
// No money moves; the school sees the receipt marked TEST.
export default async function TestGatewayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ s?: string }> }) {
  const [{ id }, { s = "" }] = await Promise.all([params, searchParams]);
  if (!/^[a-f0-9]{24}$/.test(id) || !checkTestOrder(id, s)) redirect("/dashboard/fees");
  const supabase = await createClient();
  const { data } = await supabase.from("payment_order" as never).select("amount, status, provider, mode").eq("public_id", id).maybeSingle();
  const o = data as unknown as { amount: number; status: string; provider: string; mode: string } | null;
  if (!o || o.provider !== "test") redirect("/dashboard/fees");
  if (o.status !== "created") redirect(`/dashboard/fees/payment/${id}`);
  const amount = Number(o.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  return (
    <div className="mx-auto max-w-md rounded-md border-2 border-dashed border-gold-500 bg-white p-6">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-gold-700">Test gateway: no real money</p>
      <h1 className="mt-2 text-[22px] font-semibold text-ink-900">Pay Rs {amount}</h1>
      <p className="mt-1 text-[13px] text-ink-700">This page stands in for your school&apos;s payment gateway while it is being set up. Choosing Pay records a test receipt.</p>
      <form action={finishTestPayment} className="mt-5 flex gap-3">
        <input type="hidden" name="order" value={id} />
        <input type="hidden" name="s" value={s} />
        <button name="outcome" value="pay" className="h-10 rounded-sm bg-[#0F6CBD] px-4 text-[14px] font-medium text-white hover:bg-[#115EA3]">Pay Rs {amount} (test)</button>
        <button name="outcome" value="cancel" className="h-10 rounded-sm border border-hair bg-panel px-4 text-[14px] text-ink-900">Cancel</button>
      </form>
    </div>
  );
}
