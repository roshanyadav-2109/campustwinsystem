// End-to-end test of Settings, Programmes and courses on Meridian (college, 11):
// programmes with semester credits are shown, the office adds and removes a
// course; a school (Greenfield) cannot open the page. Run from apps/desk: node .test-programmes.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { users: [], staff: [] };
async function login(school, email) {
  const { data: st } = await admin.from("staff").insert({ school_id: school, full_name: "QA Programmes (temporary)", email, role: "office" }).select("id").single(); made.staff.push(st.id);
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Programmes (temporary)", school_id: school, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  return jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" }));
}
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(await login(11, `qa-prog-${stamp}@example.com`));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("https://meridian.campustwin.org/dashboard/settings/programmes", { waitUntil: "networkidle" });
  check(await p.getByText("B.Tech CSE (BTECHCSE, R2024)").count() === 1, "the B.Tech CSE programme is shown");
  check(await p.getByText(/Current semester: odd/).count() === 1, "the current semester is shown");
  const card = p.locator("div.rounded-md", { hasText: "B.Tech CSE (BTECHCSE, R2024)" }).first();
  await card.getByRole("button", { name: "Add a course" }).click();
  await card.getByLabel("Semester").selectOption("2");
  await card.getByLabel("Code").fill(`QA${stamp}`);
  await card.getByLabel("Course name").fill("QA Engineering Ethics");
  await card.getByLabel("Credits").fill("2");
  await card.getByRole("button", { name: "Add course" }).click();
  await p.getByText("QA Engineering Ethics").waitFor({ timeout: 20000 });
  check(true, "a course was added to semester 2");
  await p.locator("tr", { hasText: "QA Engineering Ethics" }).getByRole("button", { name: "Remove" }).click();
  await p.waitForTimeout(2500);
  check(await p.getByText("QA Engineering Ethics").count() === 0, "and removed again");
  // a school does not have this page
  const sctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await sctx.addCookies(await login(8, `qa-prog-school-${stamp}@example.com`));
  const sp = await sctx.newPage();
  await sp.goto("https://greenfield.campustwin.org/dashboard/settings/programmes", { waitUntil: "networkidle" });
  check(await sp.getByText("B.Tech").count() === 0 && await sp.getByRole("button", { name: "Add programme" }).count() === 0, "a school cannot open Programmes and courses");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  await admin.from("course").delete().eq("school_id", 11).like("code", "QA%");
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) await admin.from("staff").delete().eq("id", s);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
