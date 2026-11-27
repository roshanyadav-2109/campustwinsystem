"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveWorkloadLimits(min: string, max: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!/^\d{1,2}$/.test(min.trim()) || !/^\d{1,2}$/.test(max.trim())) return { ok: false, error: "Hours are whole numbers." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_workload_limits" as never, { p_min: Number(min), p_max: Number(max) } as never);
  if (error) return { ok: false, error: error.message.length < 140 ? error.message : "Could not save." };
  revalidatePath("/dashboard/workload");
  return { ok: true, message: "Saved." };
}
