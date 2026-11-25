"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient as createJs } from "@supabase/supabase-js";
import { getCtx, ORG_COOKIE } from "@/lib/context";
import { friendly } from "@/lib/format";
import type { ActionResult } from "@/components/action-form";

// Every action runs with the signed-in agent's own session, so row security
// and the database's rules decide what is allowed. Actions return { go }
// instead of redirecting (a redirect from an action hangs on Workers).

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOrNull = (s: string) => (s && /^\d+$/.test(s) ? Number(s) : null);
const done = (ok: string, go?: string): ActionResult => { revalidatePath("/", "layout"); return { ok, go }; };
const PRIORITIES = ["low", "normal", "high", "urgent"];
const KINDS = ["request", "complaint", "grievance"];
const STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"];

export async function switchOrg(_: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const id = str(form, "org");
  if (!ctx.orgs.some((o) => o.id === id)) return { error: "You cannot open that organisation." };
  (await cookies()).set(ORG_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  return { go: "/home" };
}

export async function setupDesk(): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only a desk admin can set this up." };
  const { error } = await db.rpc("setup", { p_org: org.id });
  return error ? { error: friendly(error.message) } : done("Your help desk is ready.", "/home");
}

async function agentName(email: string | null) {
  return (email ?? "Help desk").split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 150) || "Help desk";
}

// ------------------------------------------------------------ tickets
export async function logTicket(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, userId } = await getCtx();
  const row = {
    subject: str(f, "subject"), description: str(f, "description"), kind: str(f, "kind") || "request",
    priority: str(f, "priority") || "normal", category_id: intOrNull(str(f, "category_id")),
    requester_name: str(f, "requester_name"), requester_email: str(f, "requester_email").toLowerCase() || null,
    requester_phone: str(f, "requester_phone") || null,
  };
  if (!row.requester_name) return { error: "Add who it is from." };
  if (!row.subject || !row.description) return { error: "Add a subject and what they said." };
  if (!KINDS.includes(row.kind) || !PRIORITIES.includes(row.priority)) return { error: "Choose the type and priority." };
  if (row.requester_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.requester_email)) return { error: "The email does not look right." };
  const assign = f.get("assign_me") === "on" ? userId : null;
  const { data, error } = await db.from("ticket").insert({ org_id: org.id, ...row, source: "agent", created_by: userId, assignee_id: assign, number: 0 }).select("id").single();
  return error ? { error: friendly(error.message) } : done("Request logged.", `/tickets/${data.id}`);
}

export async function updateTicket(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org } = await getCtx();
  const id = intOrNull(str(f, "id"));
  const status = str(f, "status"), priority = str(f, "priority"), kind = str(f, "kind");
  const assignee = str(f, "assignee_id") || null;
  if (!id) return { error: "Not found." };
  if (!STATUSES.includes(status) || !PRIORITIES.includes(priority) || !KINDS.includes(kind)) return { error: "Check the status, priority and type." };
  if (assignee && !/^[0-9a-f-]{36}$/.test(assignee)) return { error: "Choose who it is assigned to." };
  const { error } = await db.from("ticket").update({ status, priority, kind, assignee_id: assignee, category_id: intOrNull(str(f, "category_id")) }).eq("org_id", org.id).eq("id", id);
  return error ? { error: friendly(error.message) } : done("Saved.");
}

export async function replyTicket(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, userId, email } = await getCtx();
  const id = intOrNull(str(f, "id"));
  const body = str(f, "body");
  const internal = str(f, "mode") === "note";
  const then = str(f, "then");
  if (!id) return { error: "Not found." };
  if (!body) return { error: internal ? "Write the note." : "Write the reply." };
  if (body.length > 8000) return { error: "Keep it under 8,000 characters." };
  const { error } = await db.from("message").insert({ org_id: org.id, ticket_id: id, author_kind: "agent", author_user_id: userId, author_name: await agentName(email), body, internal });
  if (error) return { error: friendly(error.message) };
  if (!internal && ["waiting", "resolved"].includes(then)) {
    const { error: e2 } = await db.from("ticket").update({ status: then }).eq("org_id", org.id).eq("id", id);
    if (e2) return { error: friendly(e2.message) };
  }
  return done(internal ? "Note added." : then === "resolved" ? "Replied and resolved." : "Reply sent.");
}

// ------------------------------------------------------------ help centre
export async function saveArticle(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org } = await getCtx();
  const id = intOrNull(str(f, "id"));
  const row = { title: str(f, "title"), body: str(f, "body"), category_id: intOrNull(str(f, "category_id")), published: f.get("published") === "on", updated_at: new Date().toISOString() };
  if (!row.title || !row.body) return { error: "Add a title and the answer." };
  if (id) {
    const { error } = await db.from("article").update(row).eq("org_id", org.id).eq("id", id);
    return error ? { error: friendly(error.message) } : done("Saved.");
  }
  const { data, error } = await db.from("article").insert({ org_id: org.id, ...row }).select("id").single();
  return error ? { error: friendly(error.message) } : done("Article added.", `/articles/${data.id}`);
}

// ------------------------------------------------------------ settings
export async function saveSettings(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only a desk admin can change settings." };
  const hours: Record<string, number> = {};
  for (const k of ["respond_urgent", "respond_high", "respond_normal", "respond_low", "resolve_urgent", "resolve_high", "resolve_normal", "resolve_low"]) {
    const v = Number(str(f, k));
    if (!Number.isInteger(v) || v < 1 || v > (k.startsWith("respond") ? 720 : 2160)) return { error: "Deadlines are whole numbers of hours." };
    hours[k] = v;
  }
  for (const p of ["urgent", "high", "normal", "low"]) {
    if (hours[`resolve_${p}`] < hours[`respond_${p}`]) return { error: `For ${p} requests, the resolution time cannot be shorter than the response time.` };
  }
  const { error } = await db.from("settings").update({ ...hours, display_name: str(f, "display_name") || null, form_open: f.get("form_open") === "on", updated_at: new Date().toISOString() }).eq("org_id", org.id);
  return error ? { error: friendly(error.message) } : done("Settings saved. New deadlines apply to new requests and priority changes.");
}

export async function addCategory(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only a desk admin can change categories." };
  const name = str(f, "name");
  if (!name || name.length > 80) return { error: "Add a name (up to 80 characters)." };
  const { error } = await db.from("category").insert({ org_id: org.id, name });
  return error ? { error: friendly(error.message) } : done("Category added.");
}

export async function toggleCategory(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only a desk admin can change categories." };
  const { error } = await db.from("category").update({ active: str(f, "active") === "1" }).eq("org_id", org.id).eq("id", intOrNull(str(f, "id")) ?? -1);
  return error ? { error: friendly(error.message) } : done("Saved.");
}

async function loginForEmail(email: string): Promise<string | null> {
  const admin = createJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  for (let page = 1; page < 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const hit = data?.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 1000) break;
  }
  const { data: created } = await admin.auth.admin.createUser({ email, email_confirm: true });
  return created?.user?.id ?? null;
}

export async function addTeamMember(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only a desk admin can add agents." };
  const email = str(f, "email").toLowerCase();
  const role = str(f, "role");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email." };
  if (!["admin", "agent"].includes(role)) return { error: "Choose a role." };
  const userId = await loginForEmail(email);
  if (!userId) return { error: "Could not set up a login for this email." };
  const { error } = await db.from("team").upsert({ org_id: org.id, user_id: userId, role }, { onConflict: "org_id,user_id" });
  return error ? { error: friendly(error.message) } : done(`${email} can now sign in with Google.`);
}

export async function removeTeamMember(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin, userId } = await getCtx();
  if (!isAdmin) return { error: "Only a desk admin can remove agents." };
  const who = str(f, "user_id");
  if (who === userId) return { error: "You cannot remove yourself." };
  const { error } = await db.from("team").delete().eq("org_id", org.id).eq("user_id", who);
  return error ? { error: friendly(error.message) } : done("Removed.");
}
