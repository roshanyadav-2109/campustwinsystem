"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type Candidate = { staff_id: number; full_name: string; teaches_subject: boolean; teaches_section: boolean; lessons_today: number };
type R = { ok: true; message?: string } | { ok: false; error: string };
const admin = async () => { const s = await getSession(); return s && (s.staffRole === "office" || s.staffRole === "principal") ? s : null; };
const day = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function candidates(date: string, slotId: number): Promise<{ ok: true; list: Candidate[] } | { ok: false; error: string }> {
  if (!(await admin()) || !day(date)) return { ok: false, error: "Not allowed." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("substitution_candidates" as never, { p_date: date, p_slot: slotId } as never);
  if (error) return { ok: false, error: "Could not find free teachers." };
  return { ok: true, list: (data ?? []) as unknown as Candidate[] };
}

export async function assign(date: string, slotId: number, staffId: number): Promise<R> {
  const s = await admin();
  if (!s || !day(date)) return { ok: false, error: "Only the office or the principal can assign substitutions." };
  const supabase = await createClient();
  const { error } = await supabase.from("substitution" as never)
    .upsert({ on_date: date, slot_id: slotId, substitute_staff_id: staffId, created_by: s.staffId } as never, { onConflict: "on_date,slot_id" });
  if (error) return { ok: false, error: error.message.length < 120 ? error.message : "Could not assign." };
  revalidatePath("/dashboard/substitutions");
  return { ok: true, message: "Assigned. The teacher is told." };
}

export async function unassign(id: number): Promise<R> {
  if (!(await admin())) return { ok: false, error: "Not allowed." };
  const supabase = await createClient();
  const { error } = await supabase.from("substitution" as never).delete().eq("id", id);
  if (error) return { ok: false, error: "Could not remove." };
  revalidatePath("/dashboard/substitutions");
  return { ok: true, message: "Removed." };
}
