// End-to-end test of substitutions on Greenfield (8): a temporary teacher with
// two lessons today is marked absent; the office sees the lessons, finds a free
// teacher and assigns them; the substitute gets a notification. Restores everything.
// Run from apps/desk: node .test-substitutions.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SCHOOL = 8, HOST = "https://greenfield.campustwin.org";
const stamp = Date.now().toString().slice(-6);
let today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const dow = (d) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
if (dow(today) === 7) today = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { user: null, staff: [], periods: [], slots: [] };
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { data: year } = await admin.from("academic_year").select("id").eq("school_id", SCHOOL).eq("is_current", true).single();
  const { data: secs } = await admin.from("section").select("id").eq("school_id", SCHOOL).order("id").limit(1);
  const { data: subj } = await admin.from("subject").select("id").eq("school_id", SCHOOL).order("id").limit(1).single();
  for (const n of [1, 2]) {
    const { data: ex } = await admin.from("timetable_period").select("id").eq("school_id", SCHOOL).eq("period_no", n).maybeSingle();
    if (!ex) { const { data: p } = await admin.from("timetable_period").insert({ school_id: SCHOOL, period_no: n, label: `Period ${n}`, start_time: n === 1 ? "08:00" : "08:45", end_time: n === 1 ? "08:40" : "09:25", is_break: false }).select("id").single(); made.periods.push(p.id); }
  }
  const { data: away } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: `QA Away Teacher ${stamp}`, role: "subject_teacher" }).select("id").single();
  made.staff.push(away.id);
  for (const n of [1, 2]) {
    const { data: sl } = await admin.from("timetable_slot").insert({ school_id: SCHOOL, academic_year_id: year.id, section_id: secs[0].id, day_of_week: dow(today), period_no: n, subject_id: subj.id, staff_id: away.id }).select("id").single();
    made.slots.push(sl.id);
  }
  await admin.from("staff_attendance").insert({ school_id: SCHOOL, staff_id: away.id, on_date: today, status: "absent" });

  const email = `qa-subs-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Subs Office (temporary)", email, role: "office" }).select("id").single(); made.staff.push(st.id);
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.user = cu.user.id;
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Subs Office (temporary)", school_id: SCHOOL, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${HOST}/dashboard/substitutions?date=${today}`, { waitUntil: "networkidle" });
  check(await p.getByText(`QA Away Teacher ${stamp}`).count() === 1 && await p.getByRole("button", { name: "Find a substitute" }).count() >= 2, "the away teacher's two lessons are listed");
  await p.getByRole("button", { name: "Find a substitute" }).first().click();
  const sel = p.getByLabel(/^Substitute for /).first();
  await sel.waitFor({ timeout: 20000 });
  const opts = await sel.locator("option").allTextContents();
  check(opts.length > 1, `free teachers are suggested (${opts.length - 1})`);
  const pickName = opts[1].split(" · ")[0];
  await sel.selectOption({ index: 1 });
  await p.getByRole("button", { name: "Assign" }).click();
  await p.getByText(`Taken by ${pickName}`).waitFor({ timeout: 20000 });
  check(true, "a substitute is assigned");
  const { data: sub } = await admin.from("substitution").select("substitute_staff_id").eq("slot_id", made.slots[0]).single();
  const { data: note } = await admin.from("notification").select("id").eq("staff_id", sub.substitute_staff_id).eq("event_key", "substitution").limit(1);
  check((note ?? []).length === 1, "the substitute is told");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.slots.length) {
    const { data: subs } = await admin.from("substitution").select("id").in("slot_id", made.slots);
    for (const s of subs ?? []) await admin.from("notification").delete().eq("event_key", "substitution").like("dedupe_key", `substitution:${s.id}:%`);
    await admin.from("substitution").delete().in("slot_id", made.slots);
    await admin.from("timetable_slot").delete().in("id", made.slots);
  }
  if (made.periods.length) await admin.from("timetable_period").delete().in("id", made.periods);
  await admin.from("staff_attendance").delete().in("staff_id", made.staff);
  if (made.user) { await admin.from("profile").delete().eq("id", made.user); await admin.auth.admin.deleteUser(made.user); }
  for (const s of made.staff) await admin.from("staff").delete().eq("id", s);
  const { count } = await admin.from("timetable_slot").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  console.log("restored: Greenfield lessons", count);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
