// End-to-end test of revaluation, the consolidated marksheet and the rank
// list on Meridian (college, 11). Restores everything.
// Run from apps/desk: node .test-exams-a.mjs
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
const made = { users: [], staff: [], sem: null, school: null };
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
  const { data: sc } = await admin.from("school").select("reval_fee, reval_window_days").eq("id", S).single(); made.school = sc;
  await admin.from("school").update({ reval_fee: 200, reval_window_days: 15 }).eq("id", S);
  const { data: sem } = await admin.from("semester").select("id").eq("school_id", S).eq("kind", "odd").order("starts_on", { ascending: false }).limit(1).single(); made.sem = sem.id;
  const { data: regs } = await admin.from("course_registration").select("student_id").eq("semester_id", sem.id).limit(2000);
  const { data: ens } = await admin.from("student_enrollment").select("section_id").in("student_id", [...new Set(regs.map((r) => r.student_id))].slice(0, 400)).eq("status", "active");
  const count = {}; for (const e of ens) count[e.section_id] = (count[e.section_id] ?? 0) + 1;
  const sectionId = Number(Object.entries(count).sort((a, b) => b[1] - a[1])[0][0]);

  const email = `qa-ea-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA CoE (temporary)", email, role: "subject_teacher" }).select("id").single(); made.staff.push(st.id);
  const { data: coeT } = await admin.from("position_title").select("id").eq("school_id", S).eq("access_type", "exams_head").in("scope_level", ["campus", "university"]).limit(1).single();
  await admin.from("staff_position").insert({ school_id: S, staff_id: st.id, title_id: coeT.id });
  const coe = await login(email, { role: "staff", full_name: "QA CoE (temporary)", school_id: S, staff_id: st.id });
  const { error: pubErr } = await coe.client.rpc("publish_semester_results", { p_semester: sem.id, p_section: sectionId, p_revise_reason: null });
  if (pubErr) throw new Error("publish: " + pubErr.message);

  // a student asks for revaluation of a passed course
  const { data: cr } = await admin.from("course_result").select("id, student_id, ese, ese_max, course:course_id(code)").eq("semester_id", sem.id).eq("passed", true).lt("ese", 50).order("id").limit(1).single();
  const { data: stu } = await admin.from("student").select("full_name").eq("id", cr.student_id).single();
  const sl = await login(`qa-ea-s-${stamp}@example.com`, { role: "student", full_name: stu.full_name, school_id: S, student_id: cr.student_id });
  const sctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); await sctx.addCookies(sl.cookies);
  const sp = await sctx.newPage(); sp.on("pageerror", (e) => errors.push(e.message));
  await sp.goto(`${HOST}/dashboard/results`, { waitUntil: "load", timeout: 90000 }); await settle(sp);
  await sp.getByRole("button", { name: `Revaluation of ${cr.course.code}` }).first().click();
  await sp.getByText(/^Requested\./).waitFor({ timeout: 60000 });
  const { data: rq } = await admin.from("reval_request").select("id, invoice_id").eq("result_id", cr.id).single(); made.req = rq;
  check(!!rq.invoice_id, "the student asked for revaluation and a fee invoice was raised");
  const [dl] = await Promise.all([sp.waitForEvent("download", { timeout: 60000 }), sp.getByRole("button", { name: "Consolidated marksheet" }).click()]);
  check((await dl.suggestedFilename()).startsWith("Consolidated marksheet"), "the consolidated marksheet downloads");

  // the fee is paid; the CoE revises
  await admin.from("fee_invoice").update({ status: "paid", paid_amount: 200 }).eq("id", rq.invoice_id);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); await ctx.addCookies(coe.cookies);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${HOST}/dashboard/revaluation`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  await p.getByLabel(`New end-semester marks for ${stu.full_name}, ${cr.course.code}`).fill(String(Number(cr.ese) + 5));
  await p.getByRole("button", { name: "Save", exact: true }).first().click();
  await p.getByText(/^Revised\./).waitFor({ timeout: 60000 });
  const { data: after } = await admin.from("course_result").select("ese").eq("id", cr.id).single();
  check(Number(after.ese) === Number(cr.ese) + 5, "the CoE revised the marks and the result changed");

  await p.goto(`${HOST}/dashboard/results?semester=${sem.id}&section=${sectionId}`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  await p.getByRole("button", { name: "Show" }).click();
  await p.getByRole("columnheader", { name: "Rank" }).waitFor({ timeout: 60000 });
  check(await p.locator("tbody tr").count() > 0, "the rank list shows");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.req) { await admin.from("reval_request").delete().eq("id", made.req.id); if (made.req.invoice_id) await admin.from("fee_invoice").delete().eq("id", made.req.invoice_id); }
  await admin.from("course_result_revision").delete().eq("school_id", S).like("reason", "Revaluation #%");
  if (made.sem) { await admin.from("semester_result").delete().eq("semester_id", made.sem); await admin.from("course_result").delete().eq("semester_id", made.sem); }
  if (made.school) await admin.from("school").update(made.school).eq("id", S);
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) { await admin.from("staff_position").delete().eq("staff_id", s); await admin.from("staff").delete().eq("id", s); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
