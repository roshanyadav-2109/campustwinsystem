"use server";
import { publicDb, isCode } from "@/lib/public";
import type { ActionResult } from "@/components/action-form";

// A request from the public help page. Creates the ticket and sends the person
// to their private tracking link, where they can follow and reply.
export async function submitTicket(_: ActionResult, f: FormData): Promise<ActionResult> {
  const s = (k: string) => String(f.get(k) ?? "").trim();
  if (s("website")) return { ok: "Thank you. Your request has been sent." }; // filled only by bots
  const code = s("code");
  if (!isCode(code)) return { error: "This help page link is not valid." };
  const name = s("requester_name"), email = s("requester_email").toLowerCase(), subject = s("subject"), description = s("description");
  const kind = ["request", "complaint", "grievance"].includes(s("kind")) ? s("kind") : "request";
  if (!name || name.length > 150) return { error: "Add your name." };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email, or leave it empty." };
  if (!subject || subject.length > 200) return { error: "Add a short subject (up to 200 characters)." };
  if (!description || description.length > 8000) return { error: "Describe the issue (up to 8,000 characters)." };

  const db = publicDb();
  const { data: st } = await db.from("settings").select("org_id, form_open").eq("public_code", code).maybeSingle();
  if (!st || !st.form_open) return { error: "This help page is not taking requests at the moment." };
  const { data: sub } = await db.rpc("subscribed", { p_org: st.org_id });
  if (!sub) return { error: "This help page is not taking requests at the moment." };
  const cat = Number(s("category_id")) || null;
  const { data: catOk } = cat ? await db.from("category").select("id").eq("org_id", st.org_id).eq("id", cat).eq("active", true).maybeSingle() : { data: null };
  const { data, error } = await db.from("ticket").insert({
    org_id: st.org_id, subject, description, kind, priority: "normal",
    category_id: catOk ? cat : null, requester_name: name, requester_email: email || null,
    requester_phone: s("requester_phone").slice(0, 20) || null, source: "web", number: 0,
  }).select("public_token").single();
  if (error || !data) return { error: "Your request could not be sent. Please try again." };
  return { ok: "Request sent.", go: `/t/${data.public_token}?new=1` };
}
