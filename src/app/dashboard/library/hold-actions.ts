"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R = { ok: true; message?: string } | { ok: false; error: string };
const clean = (e: { message: string; code?: string } | null, f: string) => (e && (e.code === "P0001" || (e.message.length < 160 && !/violates|function|relation|column/.test(e.message))) ? e.message : f);
const PATH = "/dashboard/library";
async function rpc(name: string, args: Record<string, unknown>, ok: string, fail: string): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name as never, args as never);
  if (error) return { ok: false, error: clean(error, fail) };
  revalidatePath(PATH);
  return { ok: true, message: ok };
}
export const holdBook = async (bookId: number) => rpc("hold_book", { p_book: bookId }, "Reserved. You will be told when a copy is back.", "Could not reserve.");
export const cancelHold = async (id: number) => rpc("cancel_hold", { p_id: id }, "Cancelled.", "Could not cancel.");
export const collectHold = async (id: number) => rpc("collect_hold", { p_id: id }, "Collected.", "Could not save.");
export const saveLink = async (kind: string, title: string, url: string, note: string) => {
  if (!/^https:\/\/\S+$/.test(url.trim())) return { ok: false as const, error: "Links start with https://" };
  return rpc("save_library_link", { p_id: null, p_kind: kind, p_title: title, p_url: url.trim(), p_note: note || null }, "Added.", "Could not add.");
};
export const removeLink = async (id: number) => rpc("remove_library_link", { p_id: id }, "Removed.", "Could not remove.");

// a book search for reserving: title or author, with copies on the shelf now
export async function findBooks(q: string) {
  const supabase = await createClient();
  const term = q.trim().replace(/[%_,()]/g, " ").slice(0, 60);
  // the library's own stock figures (copies out to anyone), not just the student's own issues
  const { data: books } = await supabase.from("library_book_stock" as never).select("id, title, author, copies_available").eq("is_active", true).or(`title.ilike.%${term}%,author.ilike.%${term}%`).order("title").limit(20);
  return ((books ?? []) as unknown as { id: number; title: string; author: string; copies_available: number }[]).map((b) => ({ id: b.id, title: b.title, author: b.author, free: Math.max(0, Number(b.copies_available)) }));
}
