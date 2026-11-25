"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient as createJs } from "@supabase/supabase-js";
import { getCtx, ORG_COOKIE } from "@/lib/context";
import { friendly } from "@/lib/format";
import type { ActionResult } from "@/components/action-form";

// Every action runs with the signed-in person's own session, so row security
// and the database's own rules decide what is allowed; these checks only give
// clearer messages. Actions never call redirect() (it hangs on Workers); they
// return { go } and the browser navigates.

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const intOrNull = (s: string) => (s && /^\d+$/.test(s) ? Number(s) : null);
const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const done = (ok: string, go?: string): ActionResult => { revalidatePath("/", "layout"); return { ok, go }; };

export async function switchOrg(_: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const id = str(form, "org");
  if (!ctx.orgs.some((o) => o.id === id)) return { error: "You cannot open that institution." };
  (await cookies()).set(ORG_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  return { go: "/home" };
}

// ------------------------------------------------------------ setup, settings, team
export async function setupAlumni(): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only an alumni admin can set this up." };
  const { error } = await db.rpc("setup", { p_org: org.id });
  return error ? { error: friendly(error.message) } : done("Your alumni network is ready.", "/home");
}

export async function saveSettings(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only an alumni admin can change settings." };
  const pan = str(f, "pan").toUpperCase();
  const valid = str(f, "reg_80g_valid_until");
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { error: "A PAN has 10 characters, like AAATA1234F." };
  if (valid && !isDay(valid)) return { error: "Check the 80G validity date." };
  const { error } = await db.from("settings").update({
    display_name: str(f, "display_name") || null, address: str(f, "address") || null, pan: pan || null,
    reg_80g: str(f, "reg_80g") || null, reg_80g_valid_until: valid || null,
    fcra_registered: f.get("fcra_registered") === "on", join_open: f.get("join_open") === "on", updated_at: new Date().toISOString(),
  }).eq("org_id", org.id);
  return error ? { error: friendly(error.message) } : done("Settings saved.");
}

function serviceClient() {
  return createJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function loginForEmail(email: string): Promise<string | null> {
  const admin = serviceClient();
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
  if (!isAdmin) return { error: "Only an alumni admin can change who runs the alumni office." };
  const email = str(f, "email").toLowerCase();
  const role = str(f, "role");
  if (!emailOk(email)) return { error: "Enter a valid email." };
  if (!["admin", "editor"].includes(role)) return { error: "Choose a role." };
  const userId = await loginForEmail(email);
  if (!userId) return { error: "Could not set up a login for this email." };
  const { error } = await db.from("team").upsert({ org_id: org.id, user_id: userId, role }, { onConflict: "org_id,user_id" });
  return error ? { error: friendly(error.message) } : done(`${email} can now sign in with Google.`);
}

export async function removeTeamMember(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin, userId } = await getCtx();
  if (!isAdmin) return { error: "Only an alumni admin can change this." };
  const who = str(f, "user_id");
  if (who === userId) return { error: "You cannot remove yourself." };
  const { error } = await db.from("team").delete().eq("org_id", org.id).eq("user_id", who);
  return error ? { error: friendly(error.message) } : done("Removed.");
}

// ------------------------------------------------------------ alumni records
function profileFields(f: FormData) {
  return {
    company: str(f, "company") || null, job_title: str(f, "job_title") || null, higher_studies: str(f, "higher_studies") || null,
    city: str(f, "city") || null, country: str(f, "country") || "India", phone: str(f, "phone") || null,
    linkedin_url: str(f, "linkedin_url") || null, programme: str(f, "programme") || null,
  };
}

function officeFields(f: FormData) {
  const batch = str(f, "batch_year");
  return {
    full_name: str(f, "full_name"), email: str(f, "email").toLowerCase() || null,
    batch_year: batch ? Number(batch) : null, roll_number: str(f, "roll_number") || null, ...profileFields(f),
  };
}

function checkOffice(m: ReturnType<typeof officeFields>): string | null {
  if (!m.full_name) return "Add the name.";
  if (m.email && !emailOk(m.email)) return "The email does not look right.";
  if (m.batch_year !== null && !(Number.isInteger(m.batch_year) && m.batch_year >= 1900 && m.batch_year <= 2100)) return "The batch is the year they passed out, like 2018.";
  return null;
}

export async function addAlumnus(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can add records." };
  const m = officeFields(f);
  const bad = checkOffice(m);
  if (bad) return { error: bad };
  const { data, error } = await db.from("member").insert({ org_id: org.id, ...m, status: "verified", source: "admin" }).select("id").single();
  return error ? { error: friendly(error.message) } : done("Added. They can sign in with Google using this email.", `/office/alumni/${data.id}`);
}

export async function updateAlumnus(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can edit records." };
  const id = intOrNull(str(f, "id"));
  const m = officeFields(f);
  const bad = checkOffice(m);
  if (!id) return { error: "Not found." };
  if (bad) return { error: bad };
  const status = str(f, "status");
  if (!["pending", "verified", "rejected"].includes(status)) return { error: "Choose a status." };
  const { error } = await db.from("member").update({ ...m, status, show_in_directory: f.get("show_in_directory") === "on" }).eq("org_id", org.id).eq("id", id);
  return error ? { error: friendly(error.message) } : done("Saved.");
}

export async function reviewRequest(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can review requests." };
  const id = intOrNull(str(f, "id"));
  const decision = str(f, "decision");
  if (!id || !["verified", "rejected"].includes(decision)) return { error: "Choose approve or decline." };
  const { error } = await db.from("member").update({ status: decision }).eq("org_id", org.id).eq("id", id).eq("status", "pending");
  return error ? { error: friendly(error.message) } : done(decision === "verified" ? "Approved. They can now sign in with Google." : "Declined.");
}

// Paste rows from a spreadsheet: a header row naming the columns, then one
// alumnus per row. Commas or tabs both work. Duplicate emails are skipped.
const HEADERS: Record<string, string> = {
  name: "full_name", "full name": "full_name", email: "email", batch: "batch_year", year: "batch_year", "batch year": "batch_year",
  programme: "programme", program: "programme", course: "programme", roll: "roll_number", "roll number": "roll_number",
  company: "company", "job title": "job_title", designation: "job_title", city: "city", country: "country", phone: "phone", mobile: "phone",
};

function parseRows(text: string): string[][] {
  const sep = text.split("\n")[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((x) => x)) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x)) rows.push(row);
  return rows;
}

export async function importAlumni(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can import records." };
  const rows = parseRows(str(f, "rows"));
  if (rows.length < 2) return { error: "Paste a header row and at least one alumnus." };
  if (rows.length > 2001) return { error: "Import up to 2,000 alumni at a time." };
  const cols = rows[0].map((h) => HEADERS[h.toLowerCase()] ?? null);
  if (!cols.includes("full_name")) return { error: "The first row must name the columns, including Name." };
  // Every email already listed, read 1,000 at a time (the most one request returns).
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data: page } = await db.from("member").select("email").eq("org_id", org.id).not("email", "is", null).order("id").range(from, from + 999);
    for (const e of page ?? []) seen.add((e.email ?? "").toLowerCase());
    if (!page || page.length < 1000) break;
  }
  const out: Record<string, unknown>[] = [];
  let skipped = 0;
  const problems: string[] = [];
  rows.slice(1).forEach((r, idx) => {
    const rec: Record<string, unknown> = { org_id: org.id, status: "verified", source: "import", country: "India" };
    cols.forEach((c, i) => { if (c && r[i]) rec[c] = r[i]; });
    const line = idx + 2;
    if (!rec.full_name) { problems.push(`row ${line}: no name`); return; }
    if (rec.email) {
      const e = String(rec.email).toLowerCase();
      if (!emailOk(e)) { problems.push(`row ${line}: email`); return; }
      if (seen.has(e)) { skipped++; return; }
      seen.add(e);
      rec.email = e;
    }
    if (rec.batch_year) {
      const y = Number(rec.batch_year);
      if (!Number.isInteger(y) || y < 1900 || y > 2100) { problems.push(`row ${line}: batch`); return; }
      rec.batch_year = y;
    }
    for (const [k, max] of [["full_name", 150], ["programme", 120], ["company", 120], ["job_title", 120], ["city", 80], ["phone", 20], ["roll_number", 40]] as const) {
      if (rec[k]) rec[k] = String(rec[k]).slice(0, max);
    }
    out.push(rec);
  });
  if (problems.length > 20) return { error: `Many rows have problems (${problems.slice(0, 5).join("; ")} ...). Check the columns and try again.` };
  for (let i = 0; i < out.length; i += 500) {
    const { error } = await db.from("member").insert(out.slice(i, i + 500) as never);
    if (error) return { error: `Imported ${i} before stopping: ${friendly(error.message)}` };
  }
  return done(`Imported ${out.length}.${skipped ? ` Skipped ${skipped} already listed.` : ""}${problems.length ? ` Not imported: ${problems.join("; ")}.` : ""}`);
}

export async function updateMyProfile(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, memberId } = await getCtx();
  if (!memberId) return { error: "Your alumni record is not linked to this login." };
  const p = profileFields(f);
  const { error } = await db.from("member").update({ ...p, show_in_directory: f.get("show_in_directory") === "on" }).eq("org_id", org.id).eq("id", memberId);
  return error ? { error: friendly(error.message) } : done("Profile saved.");
}

// ------------------------------------------------------------ events, jobs, news
export async function saveEvent(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can create events." };
  const day = str(f, "day"), time = str(f, "time") || "18:00";
  if (!str(f, "title")) return { error: "Add a title." };
  if (!isDay(day) || !/^\d{2}:\d{2}$/.test(time)) return { error: "Choose the date and time." };
  const cap = str(f, "capacity");
  const row = {
    title: str(f, "title"), starts_at: new Date(`${day}T${time}:00+05:30`).toISOString(), venue: str(f, "venue") || null,
    online_url: str(f, "online_url") || null, description: str(f, "description") || null, capacity: cap ? Number(cap) : null,
  };
  if (row.capacity !== null && !(Number.isInteger(row.capacity) && row.capacity > 0)) return { error: "Capacity is a whole number." };
  const { data, error } = await db.from("event").insert({ org_id: org.id, ...row }).select("id").single();
  return error ? { error: friendly(error.message) } : done("Event published.", `/events/${data.id}`);
}

export async function cancelEvent(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can cancel events." };
  const id = intOrNull(str(f, "id"));
  const { error } = await db.from("event").update({ status: "cancelled" }).eq("org_id", org.id).eq("id", id ?? -1);
  return error ? { error: friendly(error.message) } : done("Event cancelled.");
}

export async function rsvp(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, memberId } = await getCtx();
  if (!memberId) return { error: "Only alumni can respond." };
  const event = intOrNull(str(f, "event_id"));
  const status = str(f, "status");
  if (!event || !["going", "not_going"].includes(status)) return { error: "Choose going or not going." };
  if (status === "going") {
    const { data: ev } = await db.from("event").select("capacity, status").eq("id", event).single();
    if (ev?.status !== "published") return { error: "This event is not open." };
    if (ev.capacity) {
      const { count } = await db.from("rsvp").select("member_id", { count: "exact", head: true }).eq("event_id", event).eq("status", "going").neq("member_id", memberId);
      if ((count ?? 0) >= ev.capacity) return { error: "This event is full." };
    }
  }
  const { error } = await db.from("rsvp").upsert({ org_id: org.id, event_id: event, member_id: memberId, status, updated_at: new Date().toISOString() }, { onConflict: "event_id,member_id" });
  return error ? { error: friendly(error.message) } : done(status === "going" ? "You are going." : "Noted, you are not going.");
}

export async function postJob(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff, memberId } = await getCtx();
  if (!isStaff && !memberId) return { error: "Only alumni and the alumni office can post jobs." };
  const closes = str(f, "closes_on");
  const row = {
    title: str(f, "title"), company: str(f, "company"), location: str(f, "location") || null,
    apply_url: str(f, "apply_url") || null, description: str(f, "description") || null, closes_on: closes || null,
    member_id: isStaff ? null : memberId,
  };
  if (!row.title || !row.company) return { error: "Add the role and the company." };
  if (closes && !isDay(closes)) return { error: "Check the closing date." };
  if (row.apply_url && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.apply_url)) row.apply_url = `mailto:${row.apply_url}`;
  const { error } = await db.from("job").insert({ org_id: org.id, ...row });
  return error ? { error: friendly(error.message) } : done("Job posted.");
}

export async function closeJob(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org } = await getCtx();
  const id = intOrNull(str(f, "id"));
  const { data, error } = await db.from("job").update({ status: "closed" }).eq("org_id", org.id).eq("id", id ?? -1).select("id");
  if (error) return { error: friendly(error.message) };
  return data?.length ? done("Job closed.") : { error: "You can close only jobs you posted." };
}

export async function addPost(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can post news." };
  const title = str(f, "title"), body = str(f, "body");
  if (!title || !body) return { error: "Add a title and the news." };
  const { error } = await db.from("post").insert({ org_id: org.id, title, body });
  return error ? { error: friendly(error.message) } : done("Posted.");
}

export async function deletePost(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can remove news." };
  const { error } = await db.from("post").delete().eq("org_id", org.id).eq("id", intOrNull(str(f, "id")) ?? -1);
  return error ? { error: friendly(error.message) } : done("Removed.");
}

// ------------------------------------------------------------ giving
export async function saveCampaign(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can create campaigns." };
  const goal = str(f, "goal").replace(/,/g, "");
  const row = {
    title: str(f, "title"), description: str(f, "description") || null, goal: goal ? Number(goal) : null,
    fund_type: str(f, "fund_type") || "specific", eligible_80g: f.get("eligible_80g") === "on",
  };
  if (!row.title) return { error: "Add a title." };
  if (row.goal !== null && !(row.goal > 0)) return { error: "The goal is an amount in rupees." };
  if (!["corpus", "specific", "general"].includes(row.fund_type)) return { error: "Choose the kind of fund." };
  const { error } = await db.from("campaign").insert({ org_id: org.id, ...row });
  return error ? { error: friendly(error.message) } : done("Campaign added.");
}

export async function toggleCampaign(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can change campaigns." };
  const { error } = await db.from("campaign").update({ active: str(f, "active") === "1" }).eq("org_id", org.id).eq("id", intOrNull(str(f, "id")) ?? -1);
  return error ? { error: friendly(error.message) } : done("Saved.");
}

export async function recordDonation(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can record donations." };
  const amount = Number(str(f, "amount").replace(/,/g, ""));
  const pan = str(f, "donor_pan").toUpperCase();
  const row = {
    campaign_id: intOrNull(str(f, "campaign_id")), member_id: intOrNull(str(f, "member_id")),
    donor_name: str(f, "donor_name"), donor_email: str(f, "donor_email").toLowerCase() || null, donor_pan: pan || null,
    donor_address: str(f, "donor_address") || null, donor_citizenship: str(f, "donor_citizenship") || "indian",
    amount, mode: str(f, "mode"), reference: str(f, "reference") || null, donated_on: str(f, "donated_on"),
  };
  if (!row.campaign_id) return { error: "Choose the campaign." };
  if (!row.donor_name) return { error: "Add the donor's name." };
  if (!(amount > 0) || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return { error: "Enter the amount in rupees and paise." };
  if (!["cash", "cheque", "bank_transfer", "upi", "card", "other"].includes(row.mode)) return { error: "Choose how it was paid." };
  if (!isDay(row.donated_on)) return { error: "Choose the date." };
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { error: "A PAN has 10 characters, like ABCDE1234F." };
  if (row.donor_email && !emailOk(row.donor_email)) return { error: "The email does not look right." };
  const { data, error } = await db.from("donation").insert({ org_id: org.id, ...row } as never).select("id, receipt_number, not_eligible_why").single();
  if (error) return { error: friendly(error.message) };
  const d = data as { id: number; receipt_number: string | null; not_eligible_why: string | null };
  return done(d.receipt_number ? `Recorded. 80G receipt ${d.receipt_number} issued.` : `Recorded without an 80G receipt: ${d.not_eligible_why}.`, `/giving/receipt/${d.id}`);
}

export async function cancelDonation(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isStaff } = await getCtx();
  if (!isStaff) return { error: "Only the alumni office can cancel donations." };
  const { error } = await db.from("donation").update({ status: "cancelled" }).eq("org_id", org.id).eq("id", intOrNull(str(f, "id")) ?? -1);
  return error ? { error: friendly(error.message) } : done("Donation cancelled. Its receipt number stays on record as cancelled.");
}
