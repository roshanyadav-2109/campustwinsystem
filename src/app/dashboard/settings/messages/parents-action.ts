"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setNotifyGuardians(on: boolean): Promise<string> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notify_guardians" as never, { p_on: on } as never);
  revalidatePath("/dashboard/settings/messages");
  return error ? "Could not save." : on ? "Parents are informed too." : "Only students are informed from now on.";
}
