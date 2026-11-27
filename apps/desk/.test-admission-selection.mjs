// End-to-end test of Admissions, Selection on Greenfield (8): seats, a score
// (merit list), a test slot and a booking. Restores everything.
// Run from apps/desk: node .test-admission-selection.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SCHOOL = 8, HOST = "https://greenfield.campustwin.org";
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { user: null, staff: null, enq: null, before: null, year: null };
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { data: year } = await admin.from("academic_year").select("id").eq("school_id", SCHOOL).eq("is_current", true).single(); made.year = year.id;
  const { data: enq } = await admin.from("admission_enquiry").select("id, child_name, class_id, score, score_note, app_fee_amount, app_fee_paid_on, app_fee_ref").eq("school_id", SCHOOL).eq("academic_year_id", year.id).not("status", "in", "(admitted,not_interested)").not("class_id", "is", null).limit(1).single();
  made.enq = enq; made.before = { score: enq.score, score_note: enq.score_note, app_fee_amount: enq.app_fee_amount, app_fee_paid_on: enq.app_fee_paid_on, app_fee_ref: enq.app_fee_ref };
  const { count: seatsBefore } = await admin.from("admission_seat").select("class_id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  if (seatsBefore) throw new Error("Greenfield already has seat limits; refusing to touch them");
  const email = `qa-sel-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Selection (temporary)", email, role: "office" }).select("id").single(); made.staff = st.id;
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.user = cu.user.id;
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Selection (temporary)", school_id: SCHOOL, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/admissions`, { waitUntil: "networkidle" });
  await p.getByRole("link", { name: "Seats, tests and merit list" }).click();
  await p.waitForURL(/selection/);
  await p.goto(`${HOST}/dashboard/admissions/selection?class=${enq.class_id}`, { waitUntil: "networkidle" });
  await p.getByLabel("Seats this year (empty = no limit)").fill("40");
  await p.getByRole("button", { name: "Save seats" }).click();
  await p.getByText(/admitted, \d+ left\./).waitFor({ timeout: 20000 });
  check(true, "seats saved and shown with what is left");
  // a slot, then score + booking for the applicant
  await p.getByLabel("Date and time").fill("2026-12-20T10:00");
  await p.getByLabel("Venue").fill("Hall A");
  await p.getByLabel("Places").fill("20");
  await p.getByRole("button", { name: "Add slot" }).click();
  await p.getByText("Slot added.").waitFor({ timeout: 20000 });
  await p.getByLabel(`${enq.child_name}: score`, { exact: true }).fill("87.5");
  await p.getByLabel(`${enq.child_name}: application fee`).fill("500");
  await p.getByLabel(`${enq.child_name}: test slot`).selectOption({ index: 1 });
  await p.locator("tr", { hasText: enq.child_name }).getByRole("button", { name: "Save" }).click();
  await p.locator("tr", { hasText: enq.child_name }).getByText("Saved.").waitFor({ timeout: 20000 });
  const { data: after } = await admin.from("admission_enquiry").select("score, app_fee_amount").eq("id", enq.id).single();
  check(Number(after.score) === 87.5 && Number(after.app_fee_amount) === 500, "score and application fee saved");
  const { count: bk } = await admin.from("admission_booking").select("id", { count: "exact", head: true }).eq("enquiry_id", enq.id);
  check(bk === 1, "booked into the test slot");
  await p.reload({ waitUntil: "networkidle" });
  check(await p.getByRole("cell", { name: enq.child_name, exact: true }).count() >= 1 && await p.getByText("Within seats").count() >= 1, "the merit list shows the applicant within seats");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.enq) await admin.from("admission_enquiry").update(made.before).eq("id", made.enq.id);
  await admin.from("admission_booking").delete().eq("school_id", SCHOOL);
  await admin.from("admission_slot").delete().eq("school_id", SCHOOL);
  await admin.from("admission_seat").delete().eq("school_id", SCHOOL);
  if (made.user) { await admin.from("profile").delete().eq("id", made.user); await admin.auth.admin.deleteUser(made.user); }
  if (made.staff) await admin.from("staff").delete().eq("id", made.staff);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
