"use server";
import { createClient as createJs } from "@supabase/supabase-js";
import type { ActionResult } from "@/components/action-form";

// A public request to join, sent from an institution's join link. It only ever
// creates a *pending* record in that institution's alumni list; nothing is
// visible to anyone until the alumni office approves it.
export async function requestToJoin(_: ActionResult, f: FormData): Promise<ActionResult> {
  const s = (k: string) => String(f.get(k) ?? "").trim();
  if (s("website")) return { ok: "Thank you. Your request has been sent." }; // filled only by bots
  const code = s("code");
  if (!/^[a-z0-9]{6,20}$/.test(code)) return { error: "This join link is not valid." };
  const name = s("full_name"), email = s("email").toLowerCase(), batch = Number(s("batch_year"));
  if (!name || name.length > 150) return { error: "Add your full name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email." };
  if (!Number.isInteger(batch) || batch < 1950 || batch > new Date().getFullYear() + 1) return { error: "Enter the year you passed out, like 2016." };

  const db = createJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, db: { schema: "alum" } });
  const { data: st } = await db.from("settings").select("org_id, join_open").eq("join_code", code).maybeSingle();
  if (!st || !st.join_open) return { error: "Requests to join are closed at the moment." };
  const { data: sub } = await db.rpc("subscribed", { p_org: st.org_id });
  if (!sub) return { error: "Requests to join are closed at the moment." };

  const { data: existing } = await db.from("member").select("status").eq("org_id", st.org_id).eq("email", email).maybeSingle();
  if (existing) {
    return existing.status === "verified"
      ? { ok: "You are already in the alumni network. Sign in with Google using this email." }
      : { ok: "We already have your request. The alumni office will review it soon." };
  }
  const clip = (v: string, n: number) => (v ? v.slice(0, n) : null);
  const { error } = await db.from("member").insert({
    org_id: st.org_id, full_name: name, email, batch_year: batch, status: "pending", source: "self",
    programme: clip(s("programme"), 120), roll_number: clip(s("roll_number"), 40), city: clip(s("city"), 80),
    company: clip(s("company"), 120), phone: clip(s("phone"), 20),
  });
  if (error) return { error: "Your request could not be sent. Please check the details and try again." };
  return { ok: "Thank you. The alumni office will review your request, then you can sign in with Google using this email." };
}
