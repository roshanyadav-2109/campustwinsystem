"use server";
import { revalidatePath } from "next/cache";
import { publicDb, isToken } from "@/lib/public";
import type { ActionResult } from "@/components/action-form";

// A requester's reply from their private tracking link.
export async function requesterReply(_: ActionResult, f: FormData): Promise<ActionResult> {
  const token = String(f.get("token") ?? "");
  const body = String(f.get("body") ?? "").trim();
  if (!isToken(token)) return { error: "This link is not valid." };
  if (!body) return { error: "Write your reply." };
  if (body.length > 8000) return { error: "Keep it under 8,000 characters." };
  const db = publicDb();
  const { data: t } = await db.from("ticket").select("id, org_id, requester_name, status").eq("public_token", token).maybeSingle();
  if (!t) return { error: "This request was not found." };
  if (t.status === "closed") return { error: "This request is closed. Please raise a new one from the help page." };
  const { error } = await db.from("message").insert({ org_id: t.org_id, ticket_id: t.id, author_kind: "requester", author_name: t.requester_name, body });
  if (error) return { error: "Your reply could not be sent. Please try again." };
  revalidatePath(`/t/${token}`);
  return { ok: "Reply sent." };
}
