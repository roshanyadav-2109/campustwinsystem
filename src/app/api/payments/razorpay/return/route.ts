import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GatewayOrder } from "@/core/payments/gateways";
import { checkLink, razorpayApi, razorpayKeys, razorpayPaymentSigned, safeReturn, type RazorpayPayment } from "@/core/payments/razorpay";

// Razorpay posts the checkout's result here. We check the signature with the institution's key secret, read the
// payment from Razorpay itself (amount, status), capture it if needed, and record it once. Then back to the payer's page.
export async function POST(request: NextRequest) {
  const u = request.nextUrl;
  const publicId = u.searchParams.get("o") ?? "", ret = safeReturn(u.searchParams.get("r") ?? ""), sig = u.searchParams.get("s") ?? "";
  const back = NextResponse.redirect(new URL(ret, u.origin), 303);
  if (!/^[a-f0-9]{24}$/.test(publicId) || !checkLink(publicId, ret, sig)) return back;
  const form = await request.formData().catch(() => null);
  const paymentId = String(form?.get("razorpay_payment_id") ?? ""), orderId = String(form?.get("razorpay_order_id") ?? ""), signature = String(form?.get("razorpay_signature") ?? "");
  if (!paymentId) return back;  // the payer cancelled or the try failed: the page says so, and they can try again
  const admin = createAdminClient();
  const { data } = await admin.rpc("payment_order_for_gateway" as never, { p_public_id: publicId } as never);
  const order = ((data ?? []) as unknown as GatewayOrder[])[0];
  const keys = order ? razorpayKeys(order) : null;
  if (!order || order.provider !== "razorpay" || !keys || orderId !== order.provider_order_id || !razorpayPaymentSigned(keys.key_secret, orderId, paymentId, signature)) return back;
  // the payment as Razorpay has it (never the browser's word for the amount)
  let pay = await razorpayApi<RazorpayPayment>(keys, `/payments/${encodeURIComponent(paymentId)}`);
  if (pay.ok && pay.data.status === "authorized") {
    const cap = await razorpayApi<RazorpayPayment>(keys, `/payments/${encodeURIComponent(paymentId)}/capture`, { method: "POST", body: { amount: pay.data.amount, currency: pay.data.currency } });
    if (cap.ok) pay = cap;
  }
  if (pay.ok && pay.data.status === "captured" && pay.data.order_id === order.provider_order_id) {
    await admin.rpc("complete_payment_order" as never, {
      p_public_id: publicId, p_provider_payment_id: pay.data.id, p_amount: pay.data.amount / 100, p_provider_order_id: pay.data.order_id,
      p_paid_at: pay.data.created_at ? new Date(pay.data.created_at * 1000).toISOString() : null, p_method: pay.data.method ?? null,
      p_gateway_fee: pay.data.fee != null ? pay.data.fee / 100 : null,
    } as never);
  }
  // otherwise Razorpay's webhook records it when the bank confirms
  return back;
}
