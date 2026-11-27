// Batch D on Meridian (college, 11): the exam cell dashboard, rooms and a
// seating plan with room charts, and the coded scripts page. Restores everything.
// Run from apps/desk: node .test-batch-d.mjs
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
const made = { users: [], staff: [], session: null, rooms: [], others: [] };
const settle = (p) => p.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const email = `qa-dd-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA CoE D (temporary)", email, role: "subject_teacher" }).select("id").single(); made.staff.push(st.id);
  const { data: coeT } = await admin.from("position_title").select("id").eq("school_id", S).eq("access_type", "exams_head").in("scope_level", ["campus", "university"]).limit(1).single();
  await admin.from("staff_position").insert({ school_id: S, staff_id: st.id, title_id: coeT.id });
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA CoE D", school_id: S, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/exam-cell`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  check(await p.getByText("Exams this year", { exact: true }).count() === 1 && await p.getByText("Results by semester", { exact: true }).count() === 1, "the exam cell dashboard shows exams and results by semester");

  const { data: yr } = await admin.from("academic_year").select("id").eq("school_id", S).eq("is_current", true).single();
  const { data: t } = await admin.from("assessment_type").select("id").eq("school_id", S).eq("code", "annual").single();
  const { data: cs } = await admin.from("class_subject").select("class_id, subject_id").eq("school_id", S).limit(5);
  const { data: ses } = await admin.from("exam_session").insert({ school_id: S, academic_year_id: yr.id, name: `QA Seating ${stamp}`, term: 1, assessment_type_id: t.id }).select("id").single(); made.session = ses.id;
  const d = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  await admin.from("exam_paper").insert({ school_id: S, session_id: ses.id, class_id: cs[0].class_id, subject_id: cs[0].subject_id, exam_date: d, starts_at: "09:00", ends_at: "12:00", max_marks: 100 });

  await p.goto(`${HOST}/dashboard/seating?session=${ses.id}`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  await p.getByLabel("Room name").fill(`QA Hall ${stamp}`); await p.getByLabel("Seats").fill("500");
  await p.getByRole("button", { name: "Add room" }).click();
  await p.getByText("Room added.").waitFor({ timeout: 60000 }); await settle(p);
  const { data: rm } = await admin.from("exam_room").select("id").eq("school_id", S).eq("name", `QA Hall ${stamp}`).single(); made.rooms.push(rm.id);
  const { data: others } = await admin.from("exam_room").select("id, active").eq("school_id", S).neq("id", rm.id); made.others = others ?? [];
  if (made.others.length) await admin.from("exam_room").update({ active: false }).in("id", made.others.map((x) => x.id));
  await p.reload({ waitUntil: "load", timeout: 90000 }); await settle(p);
  await p.getByRole("button", { name: "Plan seating" }).click();
  await p.getByText(/\d+ candidates seated\./).waitFor({ timeout: 60000 }); await settle(p);
  const { count: seats } = await admin.from("exam_seat").select("id", { count: "exact", head: true }).eq("session_id", ses.id);
  check((seats ?? 0) > 0, `seating planned (${seats} candidates)`);
  await p.getByRole("button", { name: "Assign duties" }).click();
  await p.getByText(/\d+ duties assigned\./).waitFor({ timeout: 60000 }); await settle(p);
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.getByRole("button", { name: "Room charts" }).click()]);
  check((await dl.suggestedFilename()).startsWith("Seating"), "duties assigned and the room charts download");

  await p.goto(`${HOST}/dashboard/scripts?session=${ses.id}`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  check(await p.getByRole("button", { name: "Code scripts" }).count() >= 1, "the coded scripts page lists the exam papers");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  for (const o of made.others) await admin.from("exam_room").update({ active: o.active }).eq("id", o.id);
  if (made.session) await admin.from("exam_session").delete().eq("id", made.session);
  for (const r of made.rooms) await admin.from("exam_room").delete().eq("id", r);
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) { await admin.from("exam_duty").delete().eq("staff_id", s); await admin.from("staff_position").delete().eq("staff_id", s); await admin.from("staff").delete().eq("id", s); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
