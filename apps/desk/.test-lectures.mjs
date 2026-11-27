// End-to-end test of lecture attendance on Meridian (college, 11): the office
// marks a lecture with one absentee; that student is listed below 75%; the
// office condones it. Restores everything. Run from apps/desk: node .test-lectures.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const S = 11, HOST = "https://meridian.campustwin.org";
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { user: null, staff: null, semester: null };
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: sem } = await admin.from("semester").select("id, starts_on, ends_on").eq("school_id", S).eq("is_current", true).single();
  made.semester = sem;
  if (today > sem.ends_on) await admin.from("semester").update({ ends_on: today }).eq("id", sem.id);
  const email = `qa-lec-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA Lectures (temporary)", email, role: "office" }).select("id").single(); made.staff = st.id;
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.user = cu.user.id;
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Lectures (temporary)", school_id: S, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${HOST}/dashboard/lectures`, { waitUntil: "networkidle" });
  const first = p.getByRole("button", { name: /: absent$/ }).first();
  const name = (await first.getAttribute("aria-label")).replace(/: absent$/, "");
  await first.click();
  await p.getByLabel("Period").selectOption("9");
  await p.getByRole("button", { name: /^Save lecture \(1 absent\)$/ }).click();
  await p.getByText(/Saved for \d+ students; 1 absent\./).waitFor({ timeout: 20000 });
  check(true, "a lecture was marked with one absentee");
  await p.getByRole("cell", { name, exact: true }).waitFor({ timeout: 20000 });
  check(await p.locator("tr", { hasText: name }).getByText("0%").count() >= 1, "the absentee is listed below 75%");
  await p.locator("tr", { hasText: name }).getByRole("button", { name: "Ask to relax" }).first().click();
  await p.getByLabel(`Reason for ${name}`).fill("QA medical certificate");
  await p.locator("tr", { hasText: name }).getByRole("button", { name: "Send" }).click();
  await p.getByText("Sent for approval.").first().waitFor({ timeout: 20000 });
  check(true, "the office asked to relax the shortage");
  // the principal approves (the principal can approve at any step)
  await admin.from("staff").update({ role: "principal" }).eq("id", made.staff);
  await p.goto(`${HOST}/dashboard/relaxations`, { waitUntil: "networkidle" });
  const item = p.locator("li", { hasText: "QA medical certificate" }).first();
  await item.getByRole("button", { name: "Approve" }).click();
  await p.getByText("Approved.").first().waitFor({ timeout: 20000 });
  check(true, "the principal approved it");
  await admin.from("staff").update({ role: "office" }).eq("id", made.staff);
  await p.goto(`${HOST}/dashboard/lectures`, { waitUntil: "networkidle" });
  check(await p.locator("tr", { hasText: name }).getByText("Relaxed").count() >= 1, "the shortage shows as relaxed");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  await admin.from("attendance_record").delete().eq("school_id", S).eq("period", 9);
  await admin.from("attendance_condonation").delete().eq("school_id", S).like("reason", "QA%");
  await admin.from("relaxation_request").delete().eq("school_id", S).like("reason", "QA%");
  if (made.semester) await admin.from("semester").update({ ends_on: made.semester.ends_on }).eq("id", made.semester.id);
  if (made.user) { await admin.from("profile").delete().eq("id", made.user); await admin.auth.admin.deleteUser(made.user); }
  if (made.staff) await admin.from("staff").delete().eq("id", made.staff);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
