"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// A person marks their own messages as read (the database checks they are theirs).
export async function markNotificationsRead(ids: number[]): Promise<{ ok: boolean }> {
  const clean = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  if (!clean.length) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read" as never, { p_ids: clean } as never);
  revalidatePath("/dashboard", "layout");
  return { ok: !error };
}
