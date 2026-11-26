import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONNECTORS, type GatewayOrder } from "@/core/payments/gateways";

// Server-to-server notices from a payment gateway. The connector verifies the
// gateway's signature; the database records the money once.
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const connector = CONNECTORS[provider];
  if (!connector?.webhook) return NextResponse.json({ error: "unknown gateway" }, { status: 404 });
  const admin = createAdminClient();
  const lookup = async (publicId: string) => {
    const { data } = await admin.rpc("payment_order_for_gateway" as never, { p_public_id: publicId } as never);
    const o = ((data ?? []) as unknown as GatewayOrder[])[0] ?? null;
    return o && o.provider === provider ? o : null;
  };
  let outcome;
  try { outcome = await connector.webhook(request, lookup); }
  catch { return NextResponse.json({ error: "could not read the notice" }, { status: 400 }); }
  if (outcome.kind === "paid") {
    await admin.rpc("complete_payment_order" as never, {
      p_public_id: outcome.publicId, p_provider_payment_id: outcome.paymentId, p_amount: outcome.amount,
      p_provider_order_id: outcome.providerOrderId ?? null, p_paid_at: outcome.paidAt ?? null, p_method: outcome.method ?? null, p_gateway_fee: outcome.fee ?? null,
    } as never);
  } else if (outcome.kind === "failed") {
    await admin.rpc("fail_payment_order" as never, { p_public_id: outcome.publicId, p_reason: outcome.reason } as never);
  } else if (outcome.kind === "refund") {
    await admin.rpc("refund_payment_order" as never, { p_public_id: outcome.publicId, p_amount: outcome.amount, p_ref: outcome.ref, p_kind: outcome.chargeback ? "chargeback" : "refund" } as never);
  }
  return NextResponse.json({ ok: true });
}
