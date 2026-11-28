import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkTestOrder } from "@/core/payments/gateways";
import { finishApplicationTestPayment } from "@/app/apply/pay/test/actions";

export const dynamic = "force-dynamic";

// The built-in test gateway for application fees (no login). No money moves.
export default async function ApplicationTestGateway({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ s?: string }> }) {
  const [{ id }, { s = "" }] = await Promise.all([params, searchParams]);
  if (!/^[a-f0-9]{24}$/.test(id) || !checkTestOrder(id, s)) redirect("/apply");
  const { data } = await createAdminClient().from("payment_order" as never).select("amount, status, provider, enquiry:enquiry_id(public_token)").eq("public_id", id).maybeSingle();
  const o = data as unknown as { amount: number; status: string; provider: string; enquiry: { public_token: string } | null } | null;
  if (!o || o.provider !== "test" || !o.enquiry) redirect("/apply");
  if (o.status !== "created") redirect(`/apply/status/${o.enquiry.public_token}`);
  const amount = Number(o.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  return (
    <main className="mx-auto mt-10 max-w-md rounded-md border-2 border-dashed border-gold-500 bg-white p-6">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-gold-700">Test gateway: no real money</p>
      <h1 className="mt-2 text-[22px] font-semibold text-ink-900">Pay Rs {amount}</h1>
      <p className="mt-1 text-[13px] text-ink-700">This page stands in for the school&apos;s payment gateway while it is being set up.</p>
      <form action={finishApplicationTestPayment} className="mt-5 flex gap-3">
        <input type="hidden" name="order" value={id} />
        <input type="hidden" name="s" value={s} />
        <button name="outcome" value="pay" className="h-10 rounded-sm bg-[#0F6CBD] px-4 text-[14px] font-medium text-white hover:bg-[#115EA3]">Pay Rs {amount} (test)</button>
        <button name="outcome" value="cancel" className="h-10 rounded-sm border border-hair bg-panel px-4 text-[14px] text-ink-900">Cancel</button>
      </form>
    </main>
  );
}
