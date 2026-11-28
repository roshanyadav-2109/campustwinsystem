import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkLink, razorpayKeys, safeReturn } from "@/core/payments/razorpay";
import type { GatewayOrder } from "@/core/payments/gateways";
import { RazorpayCheckout } from "./checkout";

// Razorpay's checkout over our page. The link is signed by the server, so the order and the return path can't be
// changed; the amount and the order come from Razorpay's order made for this bill. No sign-in (an applicant pays too).
export const dynamic = "force-dynamic";
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function RazorpayPayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ret = safeReturn(one(sp.r));
  if (!/^[a-f0-9]{24}$/.test(id) || !checkLink(id, ret, one(sp.s))) redirect("/");
  const { data } = await createAdminClient().rpc("payment_order_for_gateway" as never, { p_public_id: id } as never);
  const order = ((data ?? []) as unknown as GatewayOrder[])[0];
  if (!order || order.provider !== "razorpay" || !order.provider_order_id) redirect(ret);
  if (order.status !== "created") redirect(ret);
  const keys = razorpayKeys(order);
  if (!keys) redirect(ret);
  const back = `/api/payments/razorpay/return?o=${id}&r=${encodeURIComponent(ret)}&s=${one(sp.s)}`;
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <RazorpayCheckout
        options={{
          key: keys.key_id, order_id: order.provider_order_id, amount: Math.round(Number(order.amount) * 100), currency: order.currency || "INR",
          name: order.school_name, description: `Payment for ${order.student_name}`,
          prefill: { name: order.payer_name ?? "", email: order.payer_email ?? "", contact: order.payer_phone ?? "" },
          notes: { public_id: order.public_id }, callback_url: back, redirect: true,
        }}
        amountText={`Rs ${Number(order.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
        school={order.school_name} student={order.student_name} cancelHref={ret} test={order.mode === "test"}
      />
    </main>
  );
}
