// End-to-end test of the exam timetable on Greenfield (8): the office creates
// an exam, adds two papers for class VI (a clashing one is refused), the marks
// columns appear, publishes, downloads section admit cards; a parent sees the
// date sheet and downloads the admit card; the QR check says valid.
// Restores everything. Run from apps/desk: node .test-exam-timetable.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SCHOOL = 8, HOST = "https://greenfield.campustwin.org", SECTION = 77;
const stamp = Date.now().toString().slice(-6);
const NAME = `QA Exam ${stamp}`;
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { users: [], staff: null };

async function login(email, profile) {
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true });
  made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, ...profile });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  return jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" }));
}

const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
let page = null;
try {
  const email = `qa-exam-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Exam Office (temporary)", email, role: "office" }).select("id").single();
  made.staff = st.id;
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addCookies(await login(email, { role: "staff", full_name: "QA Exam Office (temporary)", school_id: SCHOOL, staff_id: st.id }));
  const p = await ctx.newPage(); page = p; p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/exam-timetable`, { waitUntil: "networkidle" });
  if (await p.getByRole("button", { name: "New exam" }).count()) await p.getByRole("button", { name: "New exam" }).first().click();
  await p.getByLabel("Exam name").fill(NAME);
  await p.getByLabel("Exam type").selectOption({ label: "Half-Yearly Examination" });
  await p.getByRole("button", { name: "Create exam" }).click();
  await p.getByRole("link", { name: `${NAME} (draft)` }).waitFor({ timeout: 30000 });
  check(true, "the office created an exam (draft)");

  await p.getByRole("tab", { name: "VI", exact: true }).click();
  const subj = p.getByLabel("Subject", { exact: true });
  const opts = await subj.locator("option").allTextContents();
  await subj.selectOption({ label: opts[1] });
  await p.getByLabel("Date", { exact: true }).fill("2026-12-14");
  await p.getByLabel("Starts").fill("09:00"); await p.getByLabel("Ends").fill("12:00");
  await p.getByRole("button", { name: "Add paper" }).click();
  await p.getByRole("cell", { name: opts[1], exact: true }).waitFor({ timeout: 20000 });
  await subj.selectOption({ label: opts[2] });
  await p.getByLabel("Starts").fill("10:00"); await p.getByLabel("Ends").fill("11:00");
  await p.getByRole("button", { name: "Add paper" }).click();
  await p.getByText("clashes with", { exact: false }).waitFor({ timeout: 20000 });
  check(true, "a clashing paper for the same class is refused");
  await p.getByLabel("Starts").fill("13:00"); await p.getByLabel("Ends").fill("15:00");
  await p.getByRole("button", { name: "Add paper" }).click();
  await p.getByRole("cell", { name: opts[2], exact: true }).waitFor({ timeout: 20000 });
  const { data: sess } = await admin.from("exam_session").select("id").eq("school_id", SCHOOL).eq("name", NAME).single();
  const { count: cols } = await admin.from("assessment").select("id", { count: "exact", head: true }).in("exam_paper_id", (await admin.from("exam_paper").select("id").eq("session_id", sess.id)).data.map((x) => x.id));
  check(cols === 4, `marks columns created in both sections (${cols})`);

  await p.getByRole("button", { name: "Publish" }).click();
  await p.getByText("Published. Parents and students", { exact: false }).waitFor({ timeout: 20000 });
  await p.getByLabel("Section for admit cards").selectOption({ label: "VI-A" });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.getByRole("button", { name: "Download admit cards" }).click()]);
  check((await dl.suggestedFilename()).includes("Admit cards"), "section admit cards download");

  // the parent
  const { data: en } = await admin.from("student_enrollment").select("student_id").eq("section_id", SECTION).limit(20);
  const { data: gs } = await admin.from("guardian_student").select("guardian_id, student_id").in("student_id", en.map((e) => e.student_id)).limit(1).single();
  const pctx = await b.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await pctx.addCookies(await login(`qa-exam-parent-${stamp}@example.com`, { role: "guardian", full_name: "QA Parent (temporary)", school_id: SCHOOL, guardian_id: gs.guardian_id }));
  const pp = await pctx.newPage(); pp.on("pageerror", (e) => errors.push(e.message));
  await pp.goto(`${HOST}/dashboard/exam-timetable`, { waitUntil: "networkidle" });
  check(await pp.getByText(NAME, { exact: false }).count() >= 1 && await pp.getByRole("cell", { name: opts[1], exact: true }).count() >= 1, "the parent sees the date sheet");
  const [pdl] = await Promise.all([pp.waitForEvent("download", { timeout: 30000 }), pp.getByRole("button", { name: "Download admit card" }).first().click()]);
  check((await pdl.suggestedFilename()).includes("Admit card"), "the parent downloads the admit card");
  const { data: ac } = await admin.from("exam_admit_card").select("verify_token").eq("session_id", sess.id).eq("student_id", gs.student_id).single();
  const html = await (await fetch(`https://verify.campustwin.org/verify/${ac.verify_token}`)).text();
  check(html.includes("Valid admit card"), "the QR check says the admit card is valid");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  failures++; console.log("FAIL", e.message ?? e);
  if (page) console.log("ALERTS:", JSON.stringify(await page.locator("[role=alert]").allInnerTexts().catch(() => [])));
} finally {
  const { data: ss } = await admin.from("exam_session").select("id").eq("school_id", SCHOOL).like("name", "QA Exam%");
  for (const s of ss ?? []) {
    const { data: ps } = await admin.from("exam_paper").select("id").eq("session_id", s.id);
    for (const x of ps ?? []) await admin.from("exam_paper").delete().eq("id", x.id);
    await admin.from("exam_session").delete().eq("id", s.id);
  }
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  if (made.staff) { const { error } = await admin.from("staff").delete().eq("id", made.staff); if (error) console.log("cleanup staff:", error.message); }
  const { count } = await admin.from("exam_session").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  const { count: left } = await admin.from("assessment").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL).not("exam_paper_id", "is", null);
  console.log("restored: Greenfield exams", count, "exam marks columns", left);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
