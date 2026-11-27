// End-to-end test of notifications on Greenfield (8) as a temporary office
// login: message settings (test mode, a generic SMS provider with keys),
// a test message to the bell and inbox, the delivery log, and the dispatcher
// refusing callers without its key. Restores everything.
// Run from apps/desk: node .test-notifications.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const parse = (f) => Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const env = parse(".env.production.local");
const tok = parse("../../.env.tokens.local");
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${tok.SUPABASE_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${tok.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  return r.json();
};
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SCHOOL = 8, HOST = "https://greenfield.campustwin.org";
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const until = async (fn) => { for (let i = 0; i < 20; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 1000)); } return null; };
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { user: null, staff: null };

const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { count: before } = await admin.from("notification_setting").select("channel", { count: "exact", head: true }).eq("school_id", SCHOOL);
  if (before) throw new Error("Greenfield already has message settings; refusing to overwrite them");
  const email = `qa-ntf-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Messages Office (temporary)", email, role: "office" }).select("id").single();
  made.staff = st.id;
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.user = cu.user.id;
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Messages Office (temporary)", school_id: SCHOOL, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  // 1. settings: email in test mode
  await p.goto(`${HOST}/dashboard/settings/messages`, { waitUntil: "networkidle" });
  await p.getByLabel("Email provider").selectOption("log");
  await p.getByRole("button", { name: "Save Email" }).click();
  await p.getByText("Saved.").first().waitFor({ timeout: 20000 });
  check(true, "email switched to test mode");

  // 2. SMS through a generic provider: a bad address is refused; keys are saved and never shown
  await p.getByLabel("SMS provider").selectOption("http");
  await p.getByLabel("Provider address").fill("http://not-secure.example");
  await p.getByRole("button", { name: "Save SMS" }).click();
  await p.getByText("The provider address must start with https://.").waitFor({ timeout: 20000 });
  check(true, "an insecure provider address is refused");
  await p.getByLabel("Provider address").fill("https://10.0.0.1/send");
  await p.getByRole("button", { name: "Save SMS" }).click();
  await p.getByText("Use the provider's public web address", { exact: false }).waitFor({ timeout: 20000 });
  check(true, "a private network address is refused");
  await p.getByLabel("Provider address").fill("https://sms.example.com/send");
  await p.getByRole("button", { name: "Save SMS" }).click();
  await p.getByText("Saved.").nth(0).waitFor({ timeout: 20000 });
  await p.getByLabel("Keys", { exact: true }).fill(`{"api_key":"QA-${stamp}"}`);
  await p.getByRole("button", { name: "Save keys" }).click();
  await p.getByText("Keys saved.", { exact: false }).waitFor({ timeout: 20000 });
  await p.reload({ waitUntil: "networkidle" });
  check(!(await p.content()).includes(`QA-${stamp}`), "the saved keys are not in the page");
  const officeDb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${v.session.access_token}`, "x-campustwin-school": "greenfield" } } });
  const { data: vaultTry } = await officeDb.rpc("take_deliveries", { p_limit: 1 });
  check(!vaultTry, "a signed-in office cannot pull messages or keys from the send queue");
  // back to test mode so nothing tries to reach the made-up provider
  await p.getByLabel("SMS provider").selectOption("log");
  await p.getByRole("button", { name: "Save SMS" }).click();
  await p.getByText("Saved.").first().waitFor({ timeout: 20000 });

  // 2b. which messages go where, and the institution's own SMS wording with its DLT id
  await p.getByLabel("Homework by SMS").check();
  await p.getByRole("button", { name: "Save choices" }).click();
  await p.getByText("Saved.").first().waitFor({ timeout: 20000 });
  const ch = await until(async () => (await admin.from("notification_event_channel").select("enabled").eq("school_id", SCHOOL).eq("event_key", "homework").eq("channel", "sms").maybeSingle()).data);
  check(ch?.enabled === true, "homework switched on for SMS");
  await p.getByLabel("Message", { exact: true }).selectOption("absence");
  await p.getByLabel("Text").fill("Dear parent, {student} is absent today. {school}");
  await p.getByLabel("DLT template id").fill(`1207${stamp}`);
  await p.getByRole("button", { name: "Save wording" }).click();
  await p.getByText("Saved.").first().waitFor({ timeout: 20000 });
  const tp = await until(async () => (await admin.from("notification_template").select("external_id").eq("school_id", SCHOOL).eq("event_key", "absence").eq("channel", "sms").maybeSingle()).data);
  check(tp?.external_id === `1207${stamp}`, "the SMS wording is saved with its DLT template id");

  // 3. a test message reaches the bell and the inbox
  await p.getByRole("button", { name: "Send a test message to me" }).click();
  await p.getByText("Test message sent to you.", { exact: false }).waitFor({ timeout: 20000 });
  await p.goto(`${HOST}/dashboard`, { waitUntil: "networkidle" });
  check(await p.getByRole("link", { name: /Notifications, 1 unread/ }).count() === 1, "the bell shows 1 unread");
  await p.getByRole("link", { name: /Notifications, 1 unread/ }).click();
  await p.getByText("Test message from Greenfield", { exact: false }).waitFor({ timeout: 20000 });
  check(true, "the message is in the inbox");
  await p.getByRole("button", { name: "Mark 1 as read" }).click();
  await p.getByRole("link", { name: "Notifications", exact: true }).waitFor({ timeout: 20000 });
  check(true, "marked as read; the bell has no count");

  // 4. the database completes test-mode deliveries within a minute or so
  let status = null;
  for (let i = 0; i < 18 && status !== "sent"; i++) {
    const { data } = await admin.from("notification_delivery").select("status, notification!inner(staff_id)").eq("notification.staff_id", st.id).eq("channel", "email").maybeSingle();
    status = data?.status ?? null;
    if (status !== "sent") await new Promise((r) => setTimeout(r, 5000));
  }
  check(status === "sent", `the test-mode email was recorded as sent (${status})`);
  await p.goto(`${HOST}/dashboard/settings/messages`, { waitUntil: "networkidle" });
  check(await p.getByRole("cell", { name: "Email (test)" }).count() >= 1, "the delivery log lists it");

  // 5. the dispatcher refuses callers without its key
  const d1 = await fetch(`${HOST}/api/notifications/dispatch`, { method: "POST" });
  const d2 = await fetch(`${HOST}/api/notifications/dispatch`, { method: "POST", headers: { "x-dispatch-key": "wrong" } });
  check(d1.status === 403 && d2.status === 403, `the dispatcher refuses callers without its key (${d1.status}, ${d2.status})`);
  const d3 = await fetch(`https://verify.campustwin.org/api/notifications/dispatch`, { method: "POST", headers: { "x-dispatch-key": tok.NOTIFY_DISPATCH_KEY } });
  check(d3.status === 200, `the dispatcher accepts its own key (${d3.status})`);
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  failures++; console.log("FAIL", e.message ?? e);
} finally {
  const { data: setRows } = await admin.from("notification_setting").select("secret_id").eq("school_id", SCHOOL);
  const secrets = (setRows ?? []).map((r) => r.secret_id).filter(Boolean);
  await admin.from("notification_setting").delete().eq("school_id", SCHOOL);
  await admin.from("notification_event_channel").delete().eq("school_id", SCHOOL);
  await admin.from("notification_template").delete().eq("school_id", SCHOOL);
  if (secrets.length) await sql(`delete from vault.secrets where id in (${secrets.map((s) => `'${s}'`).join(",")})`);
  if (made.staff) await admin.from("notification").delete().eq("staff_id", made.staff);
  if (made.user) { await admin.from("profile").delete().eq("id", made.user); await admin.auth.admin.deleteUser(made.user); }
  if (made.staff) { const { error } = await admin.from("staff").delete().eq("id", made.staff); if (error) console.log("cleanup staff:", error.message); }
  const { count: n } = await admin.from("notification").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  const { count: s } = await admin.from("notification_setting").select("channel", { count: "exact", head: true }).eq("school_id", SCHOOL);
  console.log("restored: Greenfield notifications", n, "settings", s);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
