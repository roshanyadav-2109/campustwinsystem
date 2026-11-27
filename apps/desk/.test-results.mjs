// End-to-end test of semester results on Meridian (college, 11): the
// evaluation scheme is shown; the office previews a section, publishes and
// downloads grade cards; a student sees SGPA/CGPA and downloads the grade
// card; the QR check works. Removes the published results afterwards.
// Run from apps/desk: node .test-results.mjs
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
const made = { users: [], staff: [], sem: null };
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
  const { count: before } = await admin.from("semester_result").select("id", { count: "exact", head: true }).eq("school_id", S);
  if (before) throw new Error("Meridian already has published results; refusing to touch them");
  const { data: sem } = await admin.from("semester").select("id").eq("school_id", S).eq("kind", "odd").order("starts_on", { ascending: false }).limit(1).single(); made.sem = sem.id;
  // a registered student with an active enrolment
  const { data: regs } = await admin.from("course_registration").select("student_id").eq("semester_id", sem.id).limit(200);
  const { data: ens } = await admin.from("student_enrollment").select("student_id, section_id, student:student_id(full_name)").in("student_id", [...new Set(regs.map((r) => r.student_id))]).eq("status", "active").limit(1);
  const en = ens[0]; const reg = { student_id: en.student_id };
  const email = `qa-res-${stamp}@example.com`;
  // a lecturer who holds the Controller of Examinations position (exam cell access comes from the position)
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA Results (temporary)", email, role: "subject_teacher" }).select("id").single(); made.staff.push(st.id);
  const { data: coeT } = await admin.from("position_title").select("id").eq("school_id", S).eq("access_type", "exams_head").in("scope_level", ["campus", "university"]).limit(1).single();
  await admin.from("staff_position").insert({ school_id: S, staff_id: st.id, title_id: coeT.id });
  const octx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await octx.addCookies(await login(email, { role: "staff", full_name: "QA Results (temporary)", school_id: S, staff_id: st.id }));
  const op = await octx.newPage(); op.on("pageerror", (e) => errors.push(e.message));

  await op.goto(`${HOST}/dashboard/settings/evaluation`, { waitUntil: "load", timeout: 90000 });

  await op.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await op.getByText("O: 90%+ = 10").first().waitFor({ timeout: 60000 }).catch(() => {});
  check(await op.getByText("Standard (CIA 40 + ESE 60)").count() >= 1 && await op.getByText("O: 90%+ = 10").count() === 1, "the evaluation scheme and grade scale are shown");

  await op.goto(`${HOST}/dashboard/results?semester=${sem.id}&section=${en.section_id}`, { waitUntil: "load", timeout: 90000 });

  await op.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  check(await op.getByRole("cell", { name: en.student.full_name, exact: true }).count() === 1, "the section's students are previewed");
  await op.getByRole("button", { name: "Publish results" }).click();
  await op.getByText(/Results published for \d+ students\./).waitFor({ timeout: 60000 }).catch(async () => { console.log("DEBUG", await op.locator("[role=alert],[role=status]").allInnerTexts(), (await op.locator("main").innerText()).slice(0, 400)); throw new Error("no publish confirmation"); });
  const { data: sr } = await admin.from("semester_result").select("sgpa, cgpa, verify_token").eq("semester_id", sem.id).eq("student_id", reg.student_id).single();
  check(sr && sr.sgpa != null && Number(sr.sgpa) === Number(sr.cgpa), `published with SGPA ${sr?.sgpa} (= CGPA after one semester)`);
  // the table refreshes after publishing (slow on the live site); the download button waits for it
  await op.getByText(/^SGPA [\d.]+ · CGPA/).first().waitFor({ timeout: 90000 });
  const [dl] = await Promise.all([op.waitForEvent("download", { timeout: 90000 }), op.getByRole("button", { name: "Download grade cards" }).click({ timeout: 60000 })]);
  check((await dl.suggestedFilename()).startsWith("Grade cards"), "the section's grade cards download");

  const sctx = await b.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await sctx.addCookies(await login(`qa-res-s-${stamp}@example.com`, { role: "student", full_name: en.student.full_name, school_id: S, student_id: reg.student_id }));
  const sp = await sctx.newPage(); sp.on("pageerror", (e) => errors.push(e.message));
  await sp.goto(`${HOST}/dashboard/results`, { waitUntil: "load", timeout: 90000 });
  await sp.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await sp.getByText(`SGPA ${Number(sr.sgpa).toFixed(2)}`, { exact: false }).first().waitFor({ timeout: 30000 }).catch(async () => console.log("DEBUG student page:", (await sp.locator("main").innerText().catch(() => "")).slice(0, 600)));
  check(await sp.getByText(`SGPA ${Number(sr.sgpa).toFixed(2)}`, { exact: false }).count() >= 1, "the student sees their SGPA");
  const [sdl] = await Promise.all([sp.waitForEvent("download", { timeout: 30000 }), sp.getByRole("button", { name: "Download grade card" }).first().click()]);
  check((await sdl.suggestedFilename()).startsWith("Grade card"), "the student downloads the grade card");
  const html = await (await fetch(`https://verify.campustwin.org/verify/${sr.verify_token}`)).text();
  check(html.includes("Grade card on record"), "the QR check finds the grade card");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.sem) { await admin.from("semester_result").delete().eq("semester_id", made.sem); await admin.from("course_result").delete().eq("semester_id", made.sem); }
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) { await admin.from("staff_position").delete().eq("staff_id", s); await admin.from("staff").delete().eq("id", s); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
