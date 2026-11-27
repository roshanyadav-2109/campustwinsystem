// Batch B on Meridian (college, 11): the workload report, and the exam
// timetable's "By course" tab for a supplementary exam. Restores everything.
// Run from apps/desk: node .test-batch-b.mjs
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
const made = { users: [], staff: [], session: null };
const settle = (p) => p.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const email = `qa-bb-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA Office B (temporary)", email, role: "office" }).select("id").single(); made.staff.push(st.id);
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Office B", school_id: S, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/workload`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  check(await p.getByText("By teacher").count() === 1 && await p.locator("tbody tr").count() > 0, "the workload report lists teachers with their weekly hours");

  const { data: sem } = await admin.from("semester").select("id").eq("school_id", S).eq("is_current", true).single();
  const { data: yr } = await admin.from("academic_year").select("id").eq("school_id", S).eq("is_current", true).single();
  const { data: t } = await admin.from("assessment_type").select("id").eq("school_id", S).eq("code", "annual").single();
  const { data: ses } = await admin.from("exam_session").insert({ school_id: S, academic_year_id: yr.id, name: `QA Supp B ${stamp}`, term: 1, assessment_type_id: t.id, kind: "supplementary", for_semester_id: sem.id }).select("id").single(); made.session = ses.id;
  await p.goto(`${HOST}/dashboard/exam-timetable?session=${ses.id}`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  const tab = p.getByRole("tab", { name: /^By course/ });
  if (!(await tab.count())) await p.getByText(`QA Supp B ${stamp}`).first().click().catch(() => {});
  await settle(p);
  check(await p.getByRole("tab", { name: /^By course/ }).count() === 1, "a supplementary exam has a By course tab for papers");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.session) await admin.from("exam_session").delete().eq("id", made.session);
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) await admin.from("staff").delete().eq("id", s);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
