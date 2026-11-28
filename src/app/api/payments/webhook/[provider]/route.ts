import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONNECTORS, type GatewayOrder } from "@/core/payments/gateways";

// Server-to-server notices from a payment gateway. The connector verifies the
// gateway's signature; the database records the money once.
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const connector = CONNECTORS[provider];
  if (!connector?.webhook) return NextResponse.json({ error: "unknown gateway" }, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > 65536) return NextResponse.json({ error: "too large" }, { status: 413 });
  const admin = createAdminClient();
  const lookup = async (publicId: string) => {
    const { data } = await admin.rpc("payment_order_for_gateway" as never, { p_public_id: publicId } as never);
    const o = ((data ?? []) as unknown as GatewayOrder[])[0] ?? null;
    return o && o.provider === provider ? o : null;
  };
  let outcome;
  try { outcome = await connector.webhook(request, lookup); }
  catch { return NextResponse.json({ error: "could not read the notice" }, { status: 400 }); }
  if (outcome.kind !== "ignored" && !(await lookup(outcome.publicId))) return NextResponse.json({ error: "unknown payment" }, { status: 404 });
  let failed = false;
  const err = (e: { code?: string } | null) => !!e && e.code !== "23505";   // already recorded: not an error
  if (outcome.kind === "paid") {
    failed = err((await admin.rpc("complete_payment_order" as never, {
      p_public_id: outcome.publicId, p_provider_payment_id: outcome.paymentId, p_amount: outcome.amount,
      p_provider_order_id: outcome.providerOrderId ?? null, p_paid_at: outcome.paidAt ?? null, p_method: outcome.method ?? null, p_gateway_fee: outcome.fee ?? null,
    } as never)).error);
  } else if (outcome.kind === "failed") {
    failed = !!(await admin.rpc("fail_payment_order" as never, { p_public_id: outcome.publicId, p_reason: outcome.reason } as never)).error;
  } else if (outcome.kind === "refund") {
    failed = err((await admin.rpc("refund_payment_order" as never, { p_public_id: outcome.publicId, p_amount: outcome.amount, p_ref: outcome.ref, p_kind: outcome.chargeback ? "chargeback" : "refund" } as never)).error);
  }
  // a database error makes the gateway send the notice again
  return failed ? NextResponse.json({ error: "try again" }, { status: 500 }) : NextResponse.json({ ok: true });
}
