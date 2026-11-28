import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GatewayOrder } from "@/core/payments/gateways";
import { capturedPayment, checkLink, paidOutcome, razorpayKeys, razorpayPaymentSigned, safeReturn, type RazorpayPayment } from "@/core/payments/razorpay";

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
  // the payment as Razorpay has it (never the browser's word for the amount); captured if only authorised
  let done: RazorpayPayment | null = null;
  try { done = await capturedPayment(keys, paymentId); } catch { done = null; }
  if (done && done.order_id === order.provider_order_id) {
    const o = paidOutcome(publicId, done);
    const { error } = await admin.rpc("complete_payment_order" as never, {
      p_public_id: publicId, p_provider_payment_id: o.paymentId, p_amount: o.amount, p_provider_order_id: o.providerOrderId,
      p_paid_at: o.paidAt ?? null, p_method: o.method ?? null, p_gateway_fee: o.fee ?? null,
    } as never);
    if (!error) return back;
  }
  // signed by Razorpay but not confirmed yet (or not recorded just now): the payer must not pay again
  await admin.rpc("mark_payment_pending" as never, { p_public_id: publicId, p_note: "Paid on Razorpay; waiting for the bank's confirmation" } as never);
  // otherwise Razorpay's webhook records it when the bank confirms
  return back;
}
