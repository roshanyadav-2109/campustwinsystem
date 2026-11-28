"use server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

// Photos of students the person may see (row security decides), for report cards and admit cards.
export async function studentPhotos(ids: number[]): Promise<Record<number, string | null>> {
  const session = await getSession();
  if (!session) return {};
  // families and students ask for their own (a few); staff for a class at most
  const uniq = [...new Set(ids.filter((x) => Number.isFinite(x)))].slice(0, session.staffId ? 2000 : 10);
  if (!uniq.length) return {};
  const supabase = await createClient();
  const out: Record<number, string | null> = {};
  for (let i = 0; i < uniq.length; i += 500) {
    const { data } = await supabase.from("student").select("id, photo_path").in("id", uniq.slice(i, i + 500));
    for (const r of (data ?? []) as { id: number; photo_path: string | null }[]) out[r.id] = r.photo_path;
  }
  return out;
}
