// End-to-end test of the front desk on Greenfield (8): a visitor in and out; a
// parent asks for an early pick-up, the office approves and records the exit;
// a health room visit; the parent sees both and is told. Restores everything.
// Run from apps/desk: node .test-front-desk.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SCHOOL = 8, HOST = "https://greenfield.campustwin.org";
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { users: [], staff: null, kid: null };
async function login(email, profile) {
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, ...profile });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  return jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" }));
}
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { data: gs } = await admin.from("guardian_student").select("guardian_id, student_id, student:student_id(full_name, admission_no)").eq("school_id", SCHOOL).limit(1).single();
  made.kid = gs.student_id;
  const email = `qa-fd-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Front Desk (temporary)", email, role: "office" }).select("id").single(); made.staff = st.id;
  const octx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await octx.addCookies(await login(email, { role: "staff", full_name: "QA Front Desk (temporary)", school_id: SCHOOL, staff_id: st.id }));
  const op = await octx.newPage(); op.on("pageerror", (e) => errors.push(e.message));
  const pctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await pctx.addCookies(await login(`qa-fd-parent-${stamp}@example.com`, { role: "guardian", full_name: "QA Parent (temporary)", school_id: SCHOOL, guardian_id: gs.guardian_id }));
  const pp = await pctx.newPage(); pp.on("pageerror", (e) => errors.push(e.message));

  // 1. visitor
  await op.goto(`${HOST}/dashboard/front-desk`, { waitUntil: "networkidle" });
  await op.getByLabel("Name", { exact: true }).fill(`QA Visitor ${stamp}`);
  await op.getByLabel("Purpose").fill("Fee enquiry");
  await op.getByRole("button", { name: "Sign in" }).click();
  await op.getByText("Signed in.").waitFor({ timeout: 20000 });
  await op.locator("li", { hasText: `QA Visitor ${stamp}` }).getByRole("button", { name: "Sign out" }).click();
  await op.getByText("Signed out.").waitFor({ timeout: 20000 });
  const { data: vis } = await admin.from("visitor").select("out_at").eq("name", `QA Visitor ${stamp}`).single();
  check(!!vis?.out_at, "a visitor signed in and out");

  // 2. the parent asks for an early pick-up
  await pp.goto(`${HOST}/dashboard/front-desk`, { waitUntil: "networkidle" });
  if (await pp.getByLabel("Student").count()) { const sel = pp.getByLabel("Student"); if ((await sel.evaluate((e) => e.tagName)) === "SELECT") await sel.selectOption({ label: gs.student.full_name }); }
  await pp.getByLabel("Reason").fill(`QA dentist ${stamp}`);
  await pp.getByLabel("Picked up by").fill("QA Mother");
  await pp.getByLabel("Leaving at").fill("2026-12-01T12:30");
  await pp.getByRole("button", { name: "Send to the office" }).click();
  await pp.getByText("Sent to the school office.").waitFor({ timeout: 20000 });
  check(true, "the parent asked for an early pick-up");

  // 3. the office approves and records the exit
  await op.goto(`${HOST}/dashboard/front-desk?view=passes`, { waitUntil: "networkidle" });
  const row = op.locator("li", { hasText: `QA dentist ${stamp}` });
  await row.getByRole("button", { name: "Approve" }).click();
  await op.getByText("Approved. The parents are told.").waitFor({ timeout: 20000 });
  await op.locator("li", { hasText: `QA dentist ${stamp}` }).getByRole("button", { name: "Left now" }).click();
  await op.getByText("Recorded. The parents are told.").waitFor({ timeout: 20000 });
  const { count: told } = await admin.from("notification").select("id", { count: "exact", head: true }).eq("guardian_id", gs.guardian_id).eq("event_key", "gate_pass");
  check(told >= 2, `the parent was told about the approval and the exit (${told})`);

  // 4. health room
  await op.goto(`${HOST}/dashboard/front-desk?view=health`, { waitUntil: "networkidle" });
  await op.getByLabel("Student for the health visit").fill(gs.student.admission_no);
  await op.getByRole("button", { name: new RegExp(gs.student.full_name) }).first().click();
  await op.getByLabel("Problem").fill(`QA stomach ache ${stamp}`);
  await op.getByRole("button", { name: "Save" }).click();
  await op.getByText("Saved. The parents are told.").waitFor({ timeout: 20000 });
  await pp.goto(`${HOST}/dashboard/front-desk`, { waitUntil: "networkidle" });
  check(await pp.getByText(`QA stomach ache ${stamp}`).count() === 1 && await pp.getByText("Left school", { exact: false }).count() >= 1, "the parent sees the health visit and the pick-up");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  await admin.from("visitor").delete().eq("school_id", SCHOOL).like("name", "QA Visitor%");
  if (made.kid) {
    await admin.from("gate_pass").delete().eq("student_id", made.kid).like("reason", "QA dentist%");
    await admin.from("health_visit").delete().eq("student_id", made.kid).like("complaint", "QA stomach%");
    await admin.from("notification").delete().eq("student_id", made.kid).in("event_key", ["gate_pass", "health_visit"]);
  }
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  if (made.staff) await admin.from("staff").delete().eq("id", made.staff);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
