"use server";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkTestOrder } from "@/core/payments/gateways";

// "Pay" / "Cancel" on the test gateway for an application fee. The signed link proves it came from our own checkout.
export async function finishApplicationTestPayment(form: FormData) {
  const publicId = String(form.get("order") ?? ""), sig = String(form.get("s") ?? ""), outcome = String(form.get("outcome") ?? "");
  if (!/^[a-f0-9]{24}$/.test(publicId) || !checkTestOrder(publicId, sig)) redirect("/apply");
  const admin = createAdminClient();
  const { data } = await admin.from("payment_order" as never).select("amount, status, provider, mode, enquiry:enquiry_id(public_token)").eq("public_id", publicId).maybeSingle();
  const o = data as unknown as { amount: number; status: string; provider: string; mode: string; enquiry: { public_token: string } | null } | null;
  if (!o || o.provider !== "test" || o.mode !== "test" || !o.enquiry) redirect("/apply");
  if (o.status === "created") {
    if (outcome === "pay") await admin.rpc("complete_payment_order" as never, { p_public_id: publicId, p_provider_payment_id: `test_${publicId}`, p_amount: o.amount, p_method: "test" } as never);
    else await admin.rpc("fail_payment_order" as never, { p_public_id: publicId, p_reason: "Cancelled on the test gateway" } as never);
  }
  redirect(`/apply/status/${o.enquiry.public_token}`);
}
