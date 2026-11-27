// University pack on Westbridge (university 2): exam cell across campuses and an
// inter-campus transfer that keeps grades and the login. Restores everything.
// Run from apps/desk: node .test-university.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";
const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const S = 14, HOST = "https://westbridge-north.campustwin.org";
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { users: [], staff: [], old: null, neu: null, guardians: [] };
const settle = (p) => p.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = []; let step = "start";
try {
  const email = `qa-un-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA Central (temporary)", email, role: "office" }).select("id").single(); made.staff.push(st.id);
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Central", school_id: S, staff_id: st.id, university_id: 2, active_campus_id: S });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/university`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  check(await p.getByText("Exam cell across campuses", { exact: true }).count() === 1 && await p.getByRole("row").count() >= 4, "central administration sees the exam cell of every campus");

  // a North student with a parent and nothing due moves to City
  const { data: cands } = await admin.from("student").select("id, admission_no, guardian_student(guardian_id)").eq("school_id", S).eq("status", "active").limit(60);
  let kid = null;
  for (const c of cands ?? []) {
    if (!c.guardian_student?.length) continue;
    const { count } = await admin.from("fee_invoice").select("id", { count: "exact", head: true }).eq("student_id", c.id).in("status", ["due", "part"]);
    if (count) continue;
    const { count: books } = await admin.from("library_issue").select("id", { count: "exact", head: true }).eq("student_id", c.id).is("returned_on", null);
    const { count: beds } = await admin.from("hostel_allocation").select("id", { count: "exact", head: true }).eq("student_id", c.id).or(`to_date.is.null,to_date.gte.${new Date().toISOString().slice(0, 10)}`);
    const { data: pe } = await admin.from("student_enrollment").select("section:section_id(class:class_id(programme_id))").eq("student_id", c.id).eq("status", "active").limit(1).maybeSingle();
    if (!books && !beds && pe?.section?.class?.programme_id) { kid = c; break; }
  }
  made.old = kid.id;
  const { data: oldEnr } = await admin.from("student_enrollment").select("id").eq("student_id", kid.id).eq("status", "active"); made.oldEnr = (oldEnr ?? []).map((x) => x.id);
  const { data: logins } = await admin.from("profile").select("id").eq("student_id", kid.id); made.logins = (logins ?? []).map((x) => x.id);
  // City has no section of this programme in the sample data: one City class teaches it for the test (restored after)
  const { data: en } = await admin.from("student_enrollment").select("section:section_id(class:class_id(programme:programme_id(*)))").eq("student_id", kid.id).eq("status", "active").limit(1).single();
  const prog = en.section.class.programme;
  let { data: tp } = await admin.from("programme").select("id").eq("school_id", 15).eq("code", prog.code).maybeSingle();
  if (!tp) {
    const copy = { ...prog }; delete copy.id; delete copy.school_id; delete copy.department_id; delete copy.eval_scheme_id;
    ({ data: tp } = await admin.from("programme").insert({ ...copy, school_id: 15 }).select("id").single()); made.prog = tp.id;
  }
  const { data: cityClass } = await admin.from("class").select("id, programme_id, name").eq("school_id", 15).order("id").limit(1).single();
  made.cityClass = cityClass; await admin.from("class").update({ programme_id: tp.id }).eq("id", cityClass.id);
  await p.getByLabel("Transfer from campus").selectOption({ label: "Westbridge North Campus" });
  await p.getByLabel("Admission number").fill(kid.admission_no);
  step = "find"; await p.getByRole("button", { name: "Find", exact: true }).click();
  await p.getByText(/^Student:/).waitFor({ timeout: 60000 });
  await p.getByLabel("Transfer to campus").selectOption({ label: "Westbridge City Campus" });
  step = "choose section"; await p.getByRole("button", { name: "Choose section" }).click();
  await p.getByLabel("Section at the new campus").waitFor({ timeout: 60000 });
  const opts = await p.getByLabel("Section at the new campus").locator("option").allTextContents();
  await p.getByLabel("Section at the new campus").selectOption({ label: opts.find((x) => x.startsWith(cityClass.name + "-")) });
  await p.getByLabel("Reason").fill("QA test transfer");
  await p.getByLabel(/Transfer even if/).check();
  step = "transfer"; await p.getByRole("button", { name: "Transfer", exact: true }).click();
  await p.getByText(/^Transferred as /).waitFor({ timeout: 90000 });
  const { data: tr } = await admin.from("student_transfer").select("to_student, carried").eq("from_student", kid.id).single(); made.neu = tr.to_student;
  const { data: gs } = await admin.from("guardian_student").select("guardian_id").eq("student_id", tr.to_student); made.guardians = (gs ?? []).map((x) => x.guardian_id);
  const { data: o } = await admin.from("student").select("status").eq("id", kid.id).single();
  check(o.status === "transferred" && made.guardians.length > 0, `the student moved to City with their parents (${tr.carried} results carried)`);
  await settle(p);
  check(await p.getByText(/QA|results carried/).count() >= 1, "the transfer is listed");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", step, e.message ?? e); }
finally {
  if (made.neu) {
    for (const id of made.logins ?? []) await admin.from("profile").update({ school_id: S, student_id: made.old }).eq("id", id);
    await admin.from("student").delete().eq("id", made.neu);
    for (const g of made.guardians) { const { count } = await admin.from("guardian_student").select("student_id", { count: "exact", head: true }).eq("guardian_id", g); if (!count) await admin.from("guardian").delete().eq("id", g); }
  }
  if (made.cityClass) await admin.from("class").update({ programme_id: made.cityClass.programme_id }).eq("id", made.cityClass.id);
  if (made.prog) await admin.from("programme").delete().eq("id", made.prog);
  if (made.old) {
    await admin.from("student").update({ status: "active", left_on: null, exit_remark: null }).eq("id", made.old);
    if (made.oldEnr?.length) await admin.from("student_enrollment").update({ status: "active" }).in("id", made.oldEnr);
  }
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) await admin.from("staff").delete().eq("id", s);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
