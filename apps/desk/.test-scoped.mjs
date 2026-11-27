// End-to-end test of department scope on Meridian (college, 11): a lecturer
// who is Head of Department approves a course registration of their
// department, and sees their department's sections in Lectures and Results.
// Restores everything. Run from apps/desk: node .test-scoped.mjs
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
const made = { users: [], staff: [], reg: null };
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
const settle = (p) => p.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
try {
  const { data: sem } = await admin.from("semester").select("id").eq("school_id", S).eq("is_current", true).single();
  // a section of some department, its programme's department, and one registration there
  const { data: secs } = await admin.from("section").select("id, name, class:class_id(name, programme:programme_id(department_id))").eq("school_id", S).limit(200);
  const sec = secs.find((x) => x.class?.programme?.department_id);
  const dept = sec.class.programme.department_id;
  const { data: en } = await admin.from("student_enrollment").select("student_id").eq("section_id", sec.id).eq("status", "active").limit(50);
  const { data: reg } = await admin.from("course_registration").select("id, status, student_id").eq("semester_id", sem.id).in("student_id", en.map((e) => e.student_id)).limit(1).single();
  made.reg = reg; await admin.from("course_registration").update({ status: "registered" }).eq("id", reg.id);

  const email = `qa-hod-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA HoD (temporary)", email, role: "subject_teacher" }).select("id").single(); made.staff.push(st.id);
  const { data: hodT } = await admin.from("position_title").select("id").eq("school_id", S).eq("access_type", "dept_head").limit(1).single();
  await admin.from("staff_position").insert({ school_id: S, staff_id: st.id, title_id: hodT.id, department_id: dept });
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA HoD (temporary)", school_id: S, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/courses`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  const waiting = p.getByText(/^Waiting for approval \((\d+)\)$/);
  await waiting.waitFor({ timeout: 60000 });
  check(Number((await waiting.innerText()).match(/\d+/)[0]) >= 1, "the HoD sees registrations waiting in their department");
  await p.getByRole("button", { name: "Approve all" }).click();
  await p.getByText(/\d+ approved\./).waitFor({ timeout: 60000 });
  const { data: after } = await admin.from("course_registration").select("status").eq("id", reg.id).single();
  check(after.status === "approved", "the HoD approved their department's registration");
  check(await p.getByRole("button", { name: "Register core courses" }).count() === 0, "registering core courses stays with the office");

  await p.goto(`${HOST}/dashboard/lectures?section=${sec.id}`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  check(await p.getByRole("link", { name: `${sec.class.name}-${sec.name}`, exact: true }).count() === 1, "Lectures lists the department's section");
  await p.goto(`${HOST}/dashboard/results?section=${sec.id}`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  check(await p.getByRole("link", { name: `${sec.class.name}-${sec.name}`, exact: true }).count() === 1 && await p.getByRole("button", { name: "Publish results" }).count() === 0,
    "Results shows the department's section to preview, without publishing");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.reg) await admin.from("course_registration").update({ status: made.reg.status }).eq("id", made.reg.id);
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) { await admin.from("staff_position").delete().eq("staff_id", s); await admin.from("staff").delete().eq("id", s); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
