"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type Result = { ok: true } | { ok: false; error: string };

// A school asks Eternity to move it to another plan. Until online billing
// exists this is a request the Eternity team approves; approving it switches
// the modules on at once.
export async function requestUpgrade(input: { plan: string; note: string }): Promise<Result> {
  const session = await getSession();
  if (!session?.staffId || (session.staffRole !== "office" && session.staffRole !== "principal")) {
    return { ok: false, error: "Only the principal or the office can ask for a plan change." };
  }
  const supabase = await createClient();
  const { data: catalog } = await supabase.rpc("campustwin_plan_catalog" as never);
  const plans = (catalog ?? []) as { code: string; name: string }[];
  const plan = plans.find((p) => p.code === input?.plan);
  if (!plan) return { ok: false, error: "Choose one of the plans shown." };
  const { data: me } = await supabase.from("school").select("plan").eq("id", session.schoolId).maybeSingle();
  if (plan.code === me?.plan) return { ok: false, error: `You are already on ${plan.name}.` };
  const note = (input?.note ?? "").trim().slice(0, 500) || null;
  const { error } = await supabase.from("plan_request" as never).insert({ requested_plan: plan.code, note, requested_by: session.staffId } as never);
  if (error) {
    return { ok: false, error: error.code === "23505" ? "A request is already waiting. The Eternity team will contact you about it." : "The request could not be sent. Please try again." };
  }
  revalidatePath("/dashboard/settings/admin");
  return { ok: true };
}
