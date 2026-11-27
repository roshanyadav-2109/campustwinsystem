// End-to-end test on Greenfield (8) as a temporary office login: the staff
// register (mark, save, month totals, Excel) and the gate scan (by typing the
// card's code: present, second scan changes nothing). Restores everything.
// Run from apps/desk: node .test-staff-attendance.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SCHOOL = 8, HOST = "https://greenfield.campustwin.org";
const stamp = Date.now().toString().slice(-6);
const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { user: null, staff: null, attendance: null, card: null };
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { count: before } = await admin.from("staff_attendance").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  if (before) throw new Error("Greenfield already has staff attendance; refusing to touch it");
  const email = `qa-satt-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Staff Office (temporary)", email, role: "office" }).select("id").single(); made.staff = st.id;
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.user = cu.user.id;
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Staff Office (temporary)", school_id: SCHOOL, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  // 1. staff register
  await p.goto(`${HOST}/dashboard/staff-attendance`, { waitUntil: "networkidle" });
  await p.getByRole("radio", { name: "QA Staff Office (temporary): Late" }).click();
  await p.getByLabel("QA Staff Office (temporary): in time").fill("09:25");
  await p.getByRole("button", { name: "Everyone else present" }).click();
  await p.getByRole("button", { name: "Save register" }).click();
  await p.getByText(/Saved for \d+ staff\./).waitFor({ timeout: 30000 });
  const { data: mine } = await admin.from("staff_attendance").select("status, in_time").eq("staff_id", st.id).eq("on_date", today).single();
  const { count: all } = await admin.from("staff_attendance").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL).eq("on_date", today);
  const { count: staffCount } = await admin.from("staff").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  check(mine?.status === "late" && mine.in_time?.startsWith("09:25"), "a late arrival with its time is saved");
  check(all === staffCount, `everyone else was marked present (${all} of ${staffCount})`);
  await p.goto(`${HOST}/dashboard/staff-attendance?view=month&month=${today.slice(0, 7)}`, { waitUntil: "networkidle" });
  const row = p.locator("tr", { hasText: "QA Staff Office (temporary)" });
  check((await row.locator("td").nth(4).innerText()).trim() === "1", "the month totals count the late day");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.getByRole("button", { name: "Download Excel" }).click()]);
  check((await dl.suggestedFilename()).startsWith("Staff attendance"), "month totals download as Excel");

  // 2. gate scan
  const { data: card } = await admin.from("id_card").select("verify_token, student_id").eq("school_id", SCHOOL).eq("status", "active").limit(1).single();
  const { data: prev } = await admin.from("attendance_record").select("*").eq("student_id", card.student_id).eq("on_date", today).is("period", null).maybeSingle();
  made.attendance = { student: card.student_id, prev };
  if (prev) await admin.from("attendance_record").delete().eq("id", prev.id);
  await p.goto(`${HOST}/dashboard/gate-scan`, { waitUntil: "networkidle" });
  await p.getByLabel("Card code").fill(`https://verify.campustwin.org/verify/${card.verify_token}`);
  await p.getByRole("button", { name: "Mark" }).click();
  await p.getByText("1 marked", { exact: true }).waitFor({ timeout: 20000 });
  const { data: recs, error: recErr } = await admin.from("attendance_record").select("status").eq("student_id", card.student_id).eq("on_date", today).is("period", null);
  check(recs?.length === 1 && recs[0].status === "present", `scanning the card marks the student present${recErr ? " (" + recErr.message + ")" : ` (${JSON.stringify(recs)})`}`);
  await p.getByLabel("Card code").fill(card.verify_token);
  await p.getByRole("button", { name: "Mark" }).click();
  await p.getByText("Already marked present", { exact: false }).waitFor({ timeout: 20000 });
  check(true, "a second scan changes nothing");
  await p.getByLabel("Card code").fill("not-a-card");
  await p.getByRole("button", { name: "Mark" }).click();
  await p.getByText("This is not a CampusTwin card", { exact: false }).waitFor({ timeout: 20000 });
  check(true, "a wrong code is refused");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  await admin.from("staff_attendance").delete().eq("school_id", SCHOOL).eq("on_date", today);
  if (made.attendance) {
    await admin.from("attendance_record").delete().eq("student_id", made.attendance.student).eq("on_date", today).is("period", null);
    await admin.from("notification_outbox").delete().eq("school_id", SCHOOL).in("event_key", ["absence", "attendance_corrected"]).is("processed_at", null);
    if (made.attendance.prev) { const { id, ...r } = made.attendance.prev; await admin.from("attendance_record").insert(r); }
  }
  if (made.user) { await admin.from("profile").delete().eq("id", made.user); await admin.auth.admin.deleteUser(made.user); }
  if (made.staff) await admin.from("staff").delete().eq("id", made.staff);
  const { count } = await admin.from("staff_attendance").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  console.log("restored: Greenfield staff attendance", count);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
