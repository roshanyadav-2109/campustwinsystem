import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GatewayOrder } from "@/core/payments/gateways";
import { HOSTED } from "@/core/payments/hosted-list";
import { checkHosted, keysOf, recordVerified, safePath } from "@/core/payments/hosted";

// The payer comes back from the gateway (by a form post or a redirect). Whatever the gateway sent with the payer is
// ignored: we ask the gateway's own status API, with the institution's keys, and record that once.
async function back(request: NextRequest, provider: string) {
  const u = request.nextUrl;
  const publicId = u.searchParams.get("o") ?? "", ret = safePath(u.searchParams.get("r") ?? ""), sig = u.searchParams.get("s") ?? "";
  const res = NextResponse.redirect(new URL(ret, u.origin), 303);
  const g = HOSTED[provider];
  if (!g || !/^[a-f0-9]{24}$/.test(publicId) || !checkHosted(publicId, ret, sig)) return res;
  const admin = createAdminClient();
  const { data } = await admin.rpc("payment_order_for_gateway" as never, { p_public_id: publicId } as never);
  const order = ((data ?? []) as unknown as GatewayOrder[])[0];
  const keys = order ? keysOf(order, g.fields) : null;
  if (!order || order.provider !== provider || !keys) return res;
  // what the gateway posted with the payer (used only by gateways that sign it with the institution's secret)
  const posted = request.method === "POST" ? new URLSearchParams(await request.text().catch(() => "")) : u.searchParams;
  try {
    let v = await g.verify(order, keys);
    if (v.status === "unknown" && g.verifyPosted && !["paid", "review"].includes(order.status)) v = g.verifyPosted(order, keys, posted);
    // not known yet: the payer may well have paid, so they are told it is being confirmed rather than to pay again
    await recordVerified(admin as never, order, v.status === "unknown" ? { status: "pending" } : v);
  } catch {
    await admin.rpc("mark_payment_pending" as never, { p_public_id: publicId, p_note: "Waiting for the gateway's confirmation" } as never);
  }
  return res;
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) { return back(request, (await params).provider); }
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) { return back(request, (await params).provider); }
