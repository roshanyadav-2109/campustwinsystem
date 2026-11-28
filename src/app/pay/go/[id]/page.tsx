import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GatewayOrder } from "@/core/payments/gateways";
import { HOSTED } from "@/core/payments/hosted-list";
import { callbackFor, checkHosted, keysOf, safePath } from "@/core/payments/hosted";
import { GoToGateway } from "./go";

// The step between our bill and the gateway's page (PayU, Easebuzz, CCAvenue, Cashfree). The link is signed by the
// server; the amount comes from the bill in the database. No sign-in (an applicant pays too).
export const dynamic = "force-dynamic";
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function GoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ret = safePath(one(sp.r));
  if (!/^[a-f0-9]{24}$/.test(id) || !checkHosted(id, ret, one(sp.s))) redirect("/");
  const admin = createAdminClient();
  const { data } = await admin.rpc("payment_order_for_gateway" as never, { p_public_id: id } as never);
  const order = ((data ?? []) as unknown as GatewayOrder[])[0];
  const g = order ? HOSTED[order.provider] : undefined;
  if (!order || !g || order.status !== "created") redirect(ret);
  const keys = keysOf(order, g.fields);
  if (!keys) redirect(ret);
  const origin = `https://${(await headers()).get("host") ?? ""}`;
  const out = await g.start(order, keys, { origin, callbackUrl: callbackFor(origin, g.id, id, ret) });
  if (!out.ok) return <main className="mx-auto max-w-md px-4 py-16 text-center text-[14px] text-down">{out.error} <a className="text-[#0F6CBD] underline" href={ret}>Back</a></main>;
  if (out.providerOrderId) await admin.rpc("set_payment_order_ref" as never, { p_public_id: id, p_provider_order_id: out.providerOrderId } as never);
  if (out.step.kind === "redirect") redirect(out.step.url);
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <GoToGateway step={out.step} amountText={`Rs ${Number(order.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} school={order.school_name} student={order.student_name} gateway={g.label} cancelHref={ret} test={order.mode === "test"} />
    </main>
  );
}
