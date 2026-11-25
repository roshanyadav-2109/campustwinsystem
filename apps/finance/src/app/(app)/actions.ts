"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient as createJs } from "@supabase/supabase-js";
import { getCtx, ORG_COOKIE } from "@/lib/context";
import { friendly } from "@/lib/format";
import type { ActionResult } from "@/components/action-form";

// Every action runs with the signed-in person's own session, so row security and
// the database's own checks decide what is allowed; these checks only give
// clearer messages. Actions never call redirect() (it hangs on Workers); they
// return { go } and the browser navigates.

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const all = (f: FormData, k: string) => f.getAll(k).map((v) => String(v).trim());
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const intOrNull = (s: string) => (s && /^\d+$/.test(s) ? Number(s) : null);
const money = (s: string) => {
  const n = Number(s.replace(/,/g, ""));
  // at most two decimals (a tolerance, because 0.1 * 100 is not exactly 10 in floating point)
  return Number.isFinite(n) && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? Math.round(n * 100) / 100 : NaN;
};
const done = (ok: string, go?: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok, go };
};

export async function switchOrg(_: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const id = str(form, "org");
  if (!ctx.orgs.some((o) => o.id === id)) return { error: "You cannot open that organisation." };
  (await cookies()).set(ORG_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  return { go: "/home" };
}

// ------------------------------------------------------------ setup and settings
export async function setupBooks(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only a finance admin can set up the books." };
  const state = str(f, "state_code");
  const gstin = str(f, "gstin").toUpperCase();
  if (!/^\d{2}$/.test(state)) return { error: "Choose your state." };
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) return { error: "A GSTIN has 15 characters, starting with the state code." };
  if (gstin && gstin.slice(0, 2) !== state) return { error: "The GSTIN does not match the state chosen." };
  const { error } = await db.rpc("setup", { p_org: org.id, p_state: state, p_gstin: gstin || undefined });
  if (error) return { error: friendly(error.message) };
  const legal = str(f, "legal_name");
  if (legal) await db.from("settings").update({ legal_name: legal }).eq("org_id", org.id);
  return done("Books are ready.", "/home");
}

export async function saveSettings(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin } = await getCtx();
  if (!isAdmin) return { error: "Only a finance admin can change settings." };
  const state = str(f, "state_code");
  const gstin = str(f, "gstin").toUpperCase();
  const lock = str(f, "books_locked_until");
  if (!/^\d{2}$/.test(state)) return { error: "Choose your state." };
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) return { error: "A GSTIN has 15 characters, starting with the state code." };
  if (gstin && gstin.slice(0, 2) !== state) return { error: "The GSTIN does not match the state chosen." };
  if (lock && !isDay(lock)) return { error: "Check the lock date." };
  const { error } = await db.from("settings").update({
    legal_name: str(f, "legal_name") || null, gstin: gstin || null, state_code: state, books_locked_until: lock || null,
    updated_at: new Date().toISOString(),
  }).eq("org_id", org.id);
  return error ? { error: friendly(error.message) } : done("Settings saved.");
}

// A login for this email: the existing one, or a new one they can use with Google.
async function loginForEmail(email: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const admin = createJs(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
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
  if (!isAdmin) return { error: "Only a finance admin can change who has access." };
  const email = str(f, "email").toLowerCase();
  const role = str(f, "role");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email." };
  if (!["admin", "accountant", "viewer"].includes(role)) return { error: "Choose a role." };
  const userId = await loginForEmail(email);
  if (!userId) return { error: "Could not set up a login for this email." };
  const { error } = await db.from("team").upsert({ org_id: org.id, user_id: userId, role }, { onConflict: "org_id,user_id" });
  return error ? { error: friendly(error.message) } : done(`${email} can now sign in with Google.`);
}

export async function removeTeamMember(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, isAdmin, userId } = await getCtx();
  if (!isAdmin) return { error: "Only a finance admin can change who has access." };
  const who = str(f, "user_id");
  if (who === userId) return { error: "You cannot remove yourself." };
  const { error } = await db.from("team").delete().eq("org_id", org.id).eq("user_id", who);
  return error ? { error: friendly(error.message) } : done("Access removed.");
}

// ------------------------------------------------------------ parties and accounts
export async function saveParty(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, canWrite } = await getCtx();
  if (!canWrite) return { error: "You have view-only access." };
  const id = intOrNull(str(f, "id"));
  const row = {
    kind: str(f, "kind") || "customer",
    name: str(f, "name"),
    gstin: str(f, "gstin").toUpperCase() || null,
    state_code: str(f, "state_code") || null,
    email: str(f, "email").toLowerCase() || null,
    phone: str(f, "phone") || null,
    address: str(f, "address") || null,
  };
  if (!["customer", "vendor", "both"].includes(row.kind)) return { error: "Choose customer or vendor." };
  if (!row.name) return { error: "Add a name." };
  if (row.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(row.gstin)) return { error: "A GSTIN has 15 characters, starting with the state code." };
  if (row.gstin && !row.state_code) row.state_code = row.gstin.slice(0, 2);
  if (row.gstin && row.state_code !== row.gstin.slice(0, 2)) return { error: "The GSTIN does not match the state chosen." };
  if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return { error: "The email does not look right." };
  const { error } = id
    ? await db.from("party").update(row).eq("org_id", org.id).eq("id", id)
    : await db.from("party").insert({ org_id: org.id, ...row });
  return error ? { error: friendly(error.message) } : done(id ? "Saved." : "Added.");
}

export async function addAccount(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, canWrite } = await getCtx();
  if (!canWrite) return { error: "You have view-only access." };
  const parentId = intOrNull(str(f, "parent_id"));
  const code = str(f, "code").toUpperCase();
  const name = str(f, "name");
  const type = str(f, "account_type") || null;
  if (!parentId) return { error: "Choose the group it belongs under." };
  if (!/^[0-9A-Z][0-9A-Z.-]{0,14}$/.test(code)) return { error: "Use a short code of digits or capital letters, for example 5215." };
  if (!name) return { error: "Add a name." };
  if (type && !["bank", "cash", "fixed_asset"].includes(type)) return { error: "Choose a valid account kind." };
  const { data: parent } = await db.from("account").select("root_type, is_group").eq("org_id", org.id).eq("id", parentId).single();
  if (!parent?.is_group) return { error: "Choose a group to put it under." };
  if ((type === "bank" || type === "cash" || type === "fixed_asset") && parent.root_type !== "asset") return { error: "Bank, cash and fixed asset accounts go under an asset group." };
  const { error } = await db.from("account").insert({
    org_id: org.id, code, name, root_type: parent.root_type, account_type: type, parent_id: parentId, is_group: f.get("is_group") === "on",
  });
  return error ? { error: friendly(error.message) } : done("Account added.");
}

export async function toggleAccount(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, canWrite } = await getCtx();
  if (!canWrite) return { error: "You have view-only access." };
  const id = intOrNull(str(f, "id"));
  if (!id) return { error: "Not found." };
  const { error } = await db.from("account").update({ active: str(f, "active") === "1" }).eq("org_id", org.id).eq("id", id);
  return error ? { error: friendly(error.message) } : done("Saved.");
}

// ------------------------------------------------------------ drafts
type Kind = "sales_invoice" | "purchase_bill" | "receipt" | "payment" | "journal";
const KINDS: Kind[] = ["sales_invoice", "purchase_bill", "receipt", "payment", "journal"];

function header(f: FormData) {
  return {
    date: str(f, "date"),
    due_date: str(f, "due_date") || null,
    party_id: intOrNull(str(f, "party_id")),
    reference: str(f, "reference") || null,
    narration: str(f, "narration") || null,
  };
}

// Create or update a draft, replacing its lines. Returns the voucher id.
export async function saveDraft(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, canWrite } = await getCtx();
  if (!canWrite) return { error: "You have view-only access." };
  const kind = str(f, "kind") as Kind;
  if (!KINDS.includes(kind)) return { error: "Unknown document." };
  const id = intOrNull(str(f, "id"));
  const h = header(f);
  if (!isDay(h.date)) return { error: "Choose the date." };
  if (h.due_date && (!isDay(h.due_date) || h.due_date < h.date)) return { error: "The due date must be on or after the date." };
  if (h.reference && h.reference.length > 80) return { error: "Keep the reference under 80 characters." };
  if (h.narration && h.narration.length > 500) return { error: "Keep the note under 500 characters." };

  const extra: Record<string, unknown> = {};
  let items: Record<string, unknown>[] = [];
  let lines: Record<string, unknown>[] = [];
  const allocs: { against_id: number; amount: number }[] = [];

  if (kind === "sales_invoice" || kind === "purchase_bill") {
    if (!h.party_id) return { error: `Choose the ${kind === "sales_invoice" ? "customer" : "vendor"}.` };
    const d = all(f, "item_description"), a = all(f, "item_account"), q = all(f, "item_qty"), r = all(f, "item_rate"), t = all(f, "item_tax");
    for (let i = 0; i < d.length; i++) {
      if (!d[i] && !r[i]) continue;
      const qty = Number(q[i] || "1"), rate = money(r[i] || ""), tax = Number(t[i] || "0"), account = intOrNull(a[i]);
      if (!d[i]) return { error: `Line ${i + 1}: add a description.` };
      if (!account) return { error: `Line ${i + 1}: choose the account.` };
      if (!(qty > 0)) return { error: `Line ${i + 1}: quantity must be more than zero.` };
      if (Number.isNaN(rate) || rate < 0) return { error: `Line ${i + 1}: enter the rate in rupees and paise.` };
      if (![0, 0.25, 3, 5, 12, 18, 28].includes(tax)) return { error: `Line ${i + 1}: choose a GST rate.` };
      items.push({ org_id: org.id, line_no: items.length + 1, description: d[i], account_id: account, qty, rate, tax_rate: tax });
    }
    if (!items.length) return { error: "Add at least one line." };
  } else if (kind === "receipt" || kind === "payment") {
    if (!h.party_id) return { error: `Choose who the money is ${kind === "receipt" ? "from" : "for"}.` };
    const amount = money(str(f, "amount"));
    if (!(amount > 0)) return { error: "Enter the amount." };
    const cash = intOrNull(str(f, "cash_account_id"));
    if (!cash) return { error: "Choose the bank or cash account." };
    extra.amount = amount;
    extra.cash_account_id = cash;
    const ids = all(f, "alloc_id"), amts = all(f, "alloc_amount");
    for (let i = 0; i < ids.length; i++) {
      if (!amts[i]) continue;
      const v = money(amts[i]);
      if (Number.isNaN(v) || v < 0) return { error: "Check the matched amounts." };
      if (v > 0) allocs.push({ against_id: Number(ids[i]), amount: v });
    }
    if (allocs.reduce((s, x) => s + x.amount, 0) > amount + 1e-9) return { error: "Matched amounts add up to more than the amount." };
  } else {
    const a = all(f, "line_account"), p = all(f, "line_party"), dr = all(f, "line_debit"), cr = all(f, "line_credit"), m = all(f, "line_memo");
    for (let i = 0; i < a.length; i++) {
      if (!a[i] && !dr[i] && !cr[i]) continue;
      const debit = dr[i] ? money(dr[i]) : 0, credit = cr[i] ? money(cr[i]) : 0;
      if (!intOrNull(a[i])) return { error: `Line ${i + 1}: choose the account.` };
      if (Number.isNaN(debit) || Number.isNaN(credit) || debit < 0 || credit < 0) return { error: `Line ${i + 1}: check the amount.` };
      if ((debit > 0) === (credit > 0)) return { error: `Line ${i + 1}: enter either a debit or a credit.` };
      lines.push({ org_id: org.id, line_no: lines.length + 1, account_id: Number(a[i]), party_id: intOrNull(p[i]), debit, credit, memo: m[i] || null });
    }
    if (lines.length < 2) return { error: "A journal needs at least two lines." };
  }

  let vid = id;
  if (vid) {
    const { error } = await db.from("voucher").update({ ...h, ...extra }).eq("org_id", org.id).eq("id", vid).eq("status", "draft");
    if (error) return { error: friendly(error.message) };
    const table = kind === "journal" ? "journal_line" : kind === "receipt" || kind === "payment" ? "allocation" : "voucher_item";
    const { error: delErr } = await db.from(table).delete().eq("voucher_id", vid);
    if (delErr) return { error: friendly(delErr.message) };
  } else {
    const { data, error } = await db.from("voucher").insert({ org_id: org.id, kind, ...h, ...extra }).select("id").single();
    if (error) return { error: friendly(error.message) };
    vid = data.id;
  }
  if (items.length) {
    items = items.map((x) => ({ ...x, voucher_id: vid }));
    const { error } = await db.from("voucher_item").insert(items as never);
    if (error) return { error: friendly(error.message) };
  }
  if (lines.length) {
    lines = lines.map((x) => ({ ...x, voucher_id: vid }));
    const { error } = await db.from("journal_line").insert(lines as never);
    if (error) return { error: friendly(error.message) };
  }
  if (allocs.length) {
    const { error } = await db.from("allocation").insert(allocs.map((x) => ({ org_id: org.id, voucher_id: vid!, ...x })));
    if (error) return { error: friendly(error.message) };
  }
  if (f.get("then") === "post") {
    const { data: num, error } = await db.rpc("post_voucher", { p_voucher: vid! });
    if (error) {
      const why = `Saved as a draft, but not posted: ${friendly(error.message)}`;
      revalidatePath("/", "layout");
      return { error: why, go: `/v/${vid}?problem=${encodeURIComponent(why)}` };
    }
    return done(`Posted as ${num}.`, `/v/${vid}`);
  }
  return done("Draft saved.", `/v/${vid}`);
}

export async function postVoucher(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, canWrite } = await getCtx();
  if (!canWrite) return { error: "You have view-only access." };
  const id = intOrNull(str(f, "id"));
  if (!id) return { error: "Not found." };
  const { data, error } = await db.rpc("post_voucher", { p_voucher: id });
  return error ? { error: friendly(error.message) } : done(`Posted as ${data}.`);
}

export async function cancelVoucher(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, canWrite } = await getCtx();
  if (!canWrite) return { error: "You have view-only access." };
  const id = intOrNull(str(f, "id"));
  if (!id) return { error: "Not found." };
  const { error } = await db.rpc("cancel_voucher", { p_voucher: id });
  return error ? { error: friendly(error.message) } : done("Cancelled. Reversing entries were added to the ledger.");
}

export async function deleteDraft(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { db, org, canWrite } = await getCtx();
  if (!canWrite) return { error: "You have view-only access." };
  const id = intOrNull(str(f, "id"));
  const back = str(f, "back") || "/home";
  if (!id) return { error: "Not found." };
  const { error } = await db.from("voucher").delete().eq("org_id", org.id).eq("id", id).eq("status", "draft");
  return error ? { error: friendly(error.message) } : done("Draft deleted.", back.startsWith("/") ? back : "/home");
}
