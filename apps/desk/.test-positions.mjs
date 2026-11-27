// End-to-end test of roles and positions on Meridian (college, 11): the
// seeded positions show; the office assigns a position, sees the title in the
// staff list, ends it; adds a custom title. Restores everything.
// Run from apps/desk: node .test-positions.mjs
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
const made = { users: [], staff: [], started: new Date().toISOString() };
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const email = `qa-pos-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA Positions (temporary)", email, role: "office" }).select("id").single(); made.staff.push(st.id);
  const { data: tt } = await admin.from("staff").insert({ school_id: S, full_name: `QA Lecturer ${stamp}`, email: `qa-pos-t-${stamp}@example.com`, role: "subject_teacher" }).select("id").single(); made.staff.push(tt.id);
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Positions (temporary)", school_id: S, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/settings/positions`, { waitUntil: "networkidle", timeout: 60000 });
  check(await p.getByRole("cell", { name: /^Dean, Faculty of Engineering and Technology$/ }).count() === 1 && await p.getByRole("cell", { name: /^Director \(Department\), Department of CSE$/ }).count() === 1,
    "the seeded Dean who is also a department Director shows both positions");

  // assign: Head of Department needs a department
  await p.getByLabel("Person").selectOption({ label: `QA Lecturer ${stamp}` });
  await p.getByLabel("Title").selectOption({ label: "Programme Coordinator" });
  await p.getByLabel("Where").selectOption({ index: 1 });
  await p.getByLabel("Acting / in charge").check();
  await p.getByRole("button", { name: "Assign" }).click();
  await p.getByText("Assigned.").waitFor({ timeout: 30000 });
  check(await p.getByRole("row", { name: new RegExp(`QA Lecturer ${stamp}.*Acting Programme Coordinator`) }).count() === 1, "a position was assigned (acting)");

  await p.goto(`${HOST}/dashboard/settings/teachers`, { waitUntil: "networkidle", timeout: 60000 });
  check(await p.getByText(/^Acting Programme Coordinator, /).count() >= 1, "the staff list shows the title under the name");

  await p.goto(`${HOST}/dashboard/settings/positions`, { waitUntil: "networkidle", timeout: 60000 });
  await p.getByRole("button", { name: new RegExp(`^End QA Lecturer ${stamp}`) }).click();
  await p.getByText("Ended today.").waitFor({ timeout: 30000 });
  const { data: ended } = await admin.from("staff_position").select("ends_on").eq("staff_id", tt.id).single();
  check(!!ended?.ends_on, "the position was ended");

  await p.getByLabel("New title").fill(`QA Dean of Research ${stamp}`);
  await p.getByLabel("Type of new title").selectOption("dean");
  await p.getByLabel("Where new title applies").selectOption("campus");
  await p.getByRole("button", { name: "Add", exact: true }).first().click();
  await p.getByLabel(`Title QA Dean of Research ${stamp}`).waitFor({ timeout: 30000 });
  check(true, "a custom title was added");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  for (const s of made.staff) await admin.from("staff_position").delete().eq("staff_id", s);
  await admin.from("position_log").delete().eq("school_id", S).gte("at", made.started);
  await admin.from("position_title").delete().eq("school_id", S).like("name", "QA %");
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) await admin.from("staff").delete().eq("id", s);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
