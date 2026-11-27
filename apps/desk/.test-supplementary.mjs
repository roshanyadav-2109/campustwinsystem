// End-to-end test of supplementary exams on Meridian (college, 11): a lecturer
// holding the Controller of Examinations position publishes a section's
// results, creates a supplementary exam with a fee, registers all backlogs,
// enters a mark and publishes; the student sees the re-take passed.
// Removes everything it made. Run from apps/desk: node .test-supplementary.mjs
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
const settle = (p) => p.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
async function login(email, profile) {
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, ...profile });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: v } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  return { cookies: jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })), client: anon };
}
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { count: before } = await admin.from("semester_result").select("id", { count: "exact", head: true }).eq("school_id", S);
  if (before) throw new Error("Meridian already has published results; refusing to touch them");
  const { data: sem } = await admin.from("semester").select("id").eq("school_id", S).eq("kind", "odd").order("starts_on", { ascending: false }).limit(1).single(); made.sem = sem.id;
  const { data: regs } = await admin.from("course_registration").select("student_id").eq("semester_id", sem.id).limit(2000);
  const { data: ens } = await admin.from("student_enrollment").select("section_id").in("student_id", [...new Set(regs.map((r) => r.student_id))].slice(0, 400)).eq("status", "active");
  const count = {}; for (const e of ens) count[e.section_id] = (count[e.section_id] ?? 0) + 1;
  const sectionId = Number(Object.entries(count).sort((a, b) => b[1] - a[1])[0][0]);

  const email = `qa-supp-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA CoE (temporary)", email, role: "subject_teacher" }).select("id").single(); made.staff.push(st.id);
  const { data: coeT } = await admin.from("position_title").select("id").eq("school_id", S).eq("access_type", "exams_head").in("scope_level", ["campus", "university"]).limit(1).single();
  await admin.from("staff_position").insert({ school_id: S, staff_id: st.id, title_id: coeT.id });
  const coe = await login(email, { role: "staff", full_name: "QA CoE (temporary)", school_id: S, staff_id: st.id });
  const { error: pubErr } = await coe.client.rpc("publish_semester_results", { p_semester: sem.id, p_section: sectionId, p_revise_reason: null });
  if (pubErr) throw new Error("publish: " + pubErr.message);
  const { data: bl } = await coe.client.rpc("semester_backlogs", { p_semester: sem.id });
  check((bl ?? []).length > 0, `the section's results are published with backlogs (${(bl ?? []).length})`);

  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); await ctx.addCookies(coe.cookies);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${HOST}/dashboard/supplementary`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  await p.getByRole("button", { name: "New supplementary exam" }).click();
  await p.getByLabel("Exam name").fill(`QA Supplementary ${stamp}`);
  await p.getByLabel("Fee per course, Rs (optional)").fill("300");
  await p.getByRole("button", { name: "Create", exact: true }).click();
  await p.getByText(`QA Supplementary ${stamp}:`, { exact: false }).first().waitFor({ timeout: 60000 }); await settle(p);
  check(true, "the exam cell created a supplementary exam");
  await p.getByRole("button", { name: "Register all backlogs" }).click();
  await p.getByText(/(\d+ backlog courses registered|No new backlogs)/).waitFor({ timeout: 60000 }).catch(async () => { console.log("DEBUG", await p.locator("[role=alert],[role=status]").allInnerTexts()); throw new Error("no registration message"); }); await settle(p);
  const { data: sess } = await admin.from("exam_session").select("id").eq("school_id", S).eq("name", `QA Supplementary ${stamp}`).single(); made.session = sess.id;
  const { data: sr } = await admin.from("supp_registration").select("id, student_id, invoice_id, course_id, course:course_id(code)").eq("session_id", sess.id).order("id").limit(1).single();
  check(!!sr && !!sr.invoice_id, "backlogs registered, with a fee invoice");

  const { data: stu } = await admin.from("student").select("full_name").eq("id", sr.student_id).single();
  await p.goto(`${HOST}/dashboard/supplementary?session=${sess.id}&course=${sr.course_id}`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  await p.getByLabel(`Marks for ${stu.full_name}, ${sr.course.code}`).fill("92");
  await p.getByRole("button", { name: /^Save marks/ }).click();
  await p.getByText(/^Saved \d+\.$/).waitFor({ timeout: 60000 }); await settle(p);
  await p.getByRole("button", { name: "Publish results" }).click();
  await p.getByText(/^Published \d+ results\.$/).waitFor({ timeout: 60000 });
  const { data: res } = await admin.from("course_result").select("attempt, passed").eq("student_id", sr.student_id).eq("semester_id", sem.id).gt("attempt", 1);
  check((res ?? []).some((r) => r.passed && r.attempt === 2), "the re-take was published as attempt 2, passed");

  const sl = await login(`qa-supp-s-${stamp}@example.com`, { role: "student", full_name: stu.full_name, school_id: S, student_id: sr.student_id });
  const sctx = await b.newContext({ viewport: { width: 420, height: 900 } }); await sctx.addCookies(sl.cookies);
  const sp = await sctx.newPage(); sp.on("pageerror", (e) => errors.push(e.message));
  await sp.goto(`${HOST}/dashboard/results`, { waitUntil: "load", timeout: 90000 }); await settle(sp);
  check(await sp.getByText(/attempt 2, passed with/).count() >= 1, "the student sees the re-take passed");
  // a second student, still waiting for their re-take, sees what they applied for
  const { data: sr2 } = await admin.from("supp_registration").select("student_id").eq("session_id", sess.id).eq("status", "registered").neq("student_id", sr.student_id).limit(1).maybeSingle();
  if (sr2) {
    const { data: stu2 } = await admin.from("student").select("full_name").eq("id", sr2.student_id).single();
    const s2 = await login(`qa-supp-s2-${stamp}@example.com`, { role: "student", full_name: stu2.full_name, school_id: S, student_id: sr2.student_id });
    const c2 = await b.newContext({ viewport: { width: 420, height: 900 } }); await c2.addCookies(s2.cookies);
    const p2 = await c2.newPage(); p2.on("pageerror", (e) => errors.push(e.message));
    await p2.goto(`${HOST}/dashboard/results`, { waitUntil: "load", timeout: 90000 }); await settle(p2);
    check(await p2.getByText(new RegExp(`Applied for QA Supplementary ${stamp}`)).count() >= 1, "a waiting student sees what they applied for and the fee");
  }
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.session) {
    const { data: inv } = await admin.from("supp_registration").select("invoice_id").eq("session_id", made.session);
    await admin.from("supp_registration").delete().eq("session_id", made.session);
    const ids = [...new Set((inv ?? []).map((x) => x.invoice_id).filter(Boolean))];
    if (ids.length) await admin.from("fee_invoice").delete().in("id", ids);
    await admin.from("fee_invoice").delete().eq("school_id", S).like("title", `Supplementary exam fee: QA Supplementary ${stamp}%`);
    await admin.from("exam_admit_card").delete().eq("session_id", made.session);
    await admin.from("exam_session").delete().eq("id", made.session);
  }
  if (made.sem) { await admin.from("semester_result").delete().eq("semester_id", made.sem); await admin.from("course_result").delete().eq("semester_id", made.sem); }
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) { await admin.from("staff_position").delete().eq("staff_id", s); await admin.from("staff").delete().eq("id", s); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
