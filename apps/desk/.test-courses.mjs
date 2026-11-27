// End-to-end test of course registration on Meridian (college, 11): the office
// registers core courses; a student takes the only seat of an elective; a
// second student sees it full; the office approves. Restores everything.
// Run from apps/desk: node .test-courses.mjs
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
const made = { users: [], staff: [], course: null, started: null };
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
  made.started = new Date().toISOString();
  const { data: sem } = await admin.from("semester").select("id, kind").eq("school_id", S).eq("is_current", true).single();
  const { data: cls } = await admin.from("class").select("id, programme_id, year_no").eq("school_id", S).eq("name", "B.Tech CSE Year 1").single();
  const semNo = 2 * cls.year_no - (sem.kind === "odd" ? 1 : 0);
  const { data: secs } = await admin.from("section").select("id").eq("class_id", cls.id);
  const { data: kids } = await admin.from("student_enrollment").select("student_id, student:student_id(full_name)").in("section_id", secs.map((x) => x.id)).eq("status", "active").limit(2);
  const { data: c } = await admin.from("course").insert({ school_id: S, code: `QAE${stamp}`, name: `QA Elective ${stamp}`, kind: "elective", credits: 3 }).select("id").single(); made.course = c.id;
  await admin.from("programme_course").insert({ school_id: S, programme_id: cls.programme_id, course_id: c.id, semester_no: semNo, elective_group: "QA choice", seat_limit: 1 });

  const email = `qa-crs-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA Courses (temporary)", email, role: "office" }).select("id").single(); made.staff.push(st.id);
  const octx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await octx.addCookies(await login(email, { role: "staff", full_name: "QA Courses (temporary)", school_id: S, staff_id: st.id }));
  const op = await octx.newPage(); op.on("pageerror", (e) => errors.push(e.message));
  await op.goto(`${HOST}/dashboard/courses`, { waitUntil: "networkidle" });
  await op.getByRole("button", { name: "Register core courses" }).click();
  await op.getByText(/\d+ core course registrations added\./).waitFor({ timeout: 30000 });
  const { count: core } = await admin.from("course_registration").select("id", { count: "exact", head: true }).eq("school_id", S).eq("semester_id", sem.id);
  check(core > 0, `core courses registered for every student (${core})`);

  const s1 = await b.newContext({ viewport: { width: 420, height: 900 } });
  await s1.addCookies(await login(`qa-crs-s1-${stamp}@example.com`, { role: "student", full_name: kids[0].student.full_name, school_id: S, student_id: kids[0].student_id }));
  const p1 = await s1.newPage(); p1.on("pageerror", (e) => errors.push(e.message));
  await p1.goto(`${HOST}/dashboard/courses`, { waitUntil: "networkidle" });
  await p1.locator("li", { hasText: `QA Elective ${stamp}` }).getByRole("button", { name: "Choose" }).click();
  await p1.getByText("Chosen, waiting for approval").waitFor({ timeout: 20000 });
  check(true, "a student chose the elective");
  const s2 = await b.newContext({ viewport: { width: 420, height: 900 } });
  await s2.addCookies(await login(`qa-crs-s2-${stamp}@example.com`, { role: "student", full_name: kids[1].student.full_name, school_id: S, student_id: kids[1].student_id }));
  const p2 = await s2.newPage();
  await p2.goto(`${HOST}/dashboard/courses`, { waitUntil: "networkidle" });
  check(await p2.locator("li", { hasText: `QA Elective ${stamp}` }).getByRole("button", { name: "Full" }).isDisabled(), "the second student sees it full");

  await op.reload({ waitUntil: "networkidle" });
  await op.getByRole("button", { name: "Approve all" }).click();
  await op.getByText(/\d+ approved\./).waitFor({ timeout: 20000 });
  const { data: reg } = await admin.from("course_registration").select("status").eq("student_id", kids[0].student_id).eq("semester_id", sem.id).eq("status", "approved");
  check((reg ?? []).length > 0, "the office approved the choice");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.started) await admin.from("course_registration").delete().eq("school_id", S).gte("created_at", made.started);
  if (made.course) await admin.from("course").delete().eq("id", made.course);
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) await admin.from("staff").delete().eq("id", s);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
