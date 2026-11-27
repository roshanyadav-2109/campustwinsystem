// End-to-end test on Greenfield (8): hostel (add, room, assign a bed, a second
// bed for the same student refused, move out) and inventory (add, receive,
// issue, over-issue refused). Restores everything. Run from apps/desk: node .test-hostel-inventory.mjs
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
const made = { user: null, staff: null };
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { data: kid } = await admin.from("student").select("id, full_name, admission_no").eq("school_id", SCHOOL).eq("status", "active").limit(1).single();
  const email = `qa-hi-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Ops (temporary)", email, role: "office" }).select("id").single(); made.staff = st.id;
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.user = cu.user.id;
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Ops (temporary)", school_id: SCHOOL, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  // hostel
  await p.goto(`${HOST}/dashboard/hostel`, { waitUntil: "networkidle" });
  await p.getByLabel("Name", { exact: true }).fill(`QA House ${stamp}`);
  await p.getByRole("button", { name: "Add hostel" }).click();
  await p.getByText(`QA House ${stamp} (mixed)`).waitFor({ timeout: 20000 });
  await p.getByLabel("Room", { exact: true }).fill("101");
  await p.getByLabel("Beds").fill("2");
  await p.getByRole("button", { name: "Add room" }).click();
  await p.getByText("Room 101").waitFor({ timeout: 20000 });
  await p.getByRole("button", { name: "Assign" }).first().click();
  await p.getByLabel("Student for bed 1").fill(kid.admission_no);
  await p.getByRole("button", { name: new RegExp(kid.full_name) }).first().click();
  await p.getByText("Move out").waitFor({ timeout: 20000 });
  check(true, "a student was given bed 1");
  await p.getByRole("button", { name: "Assign" }).first().click();
  await p.getByLabel("Student for bed 2").fill(kid.admission_no);
  await p.getByRole("button", { name: new RegExp(kid.full_name) }).first().click();
  await p.getByText("This student already has a bed.", { exact: false }).waitFor({ timeout: 20000 });
  check(true, "the same student cannot take a second bed");
  await p.getByRole("button", { name: "Move out" }).click();
  await p.getByText("Moved out.").waitFor({ timeout: 20000 });
  check(true, "moved out");

  // inventory
  await p.goto(`${HOST}/dashboard/inventory`, { waitUntil: "networkidle" });
  await p.getByLabel("New item").fill(`QA Chalk ${stamp}`);
  await p.getByLabel("Unit").fill("box");
  await p.getByLabel("Warn below").fill("5");
  await p.getByRole("button", { name: "Add item" }).click();
  await p.getByText("Item added.").waitFor({ timeout: 20000 });
  await p.getByLabel("Item", { exact: true }).selectOption({ label: `QA Chalk ${stamp}` });
  await p.getByLabel("What").selectOption("received"); await p.getByLabel("How many").fill("10");
  await p.getByRole("button", { name: "Save" }).click(); await p.getByText("Saved.").waitFor({ timeout: 20000 });
  await p.getByLabel("Item", { exact: true }).selectOption({ label: `QA Chalk ${stamp}` });
  await p.getByLabel("What").selectOption("issued"); await p.getByLabel("How many").fill("6"); await p.getByLabel("To / from").fill("VI-A");
  await p.getByRole("button", { name: "Save" }).click(); await p.waitForTimeout(2500);
  const { data: item } = await admin.from("inventory_item").select("stock").eq("school_id", SCHOOL).eq("name", `QA Chalk ${stamp}`).single();
  check(Number(item.stock) === 4, `stock follows the movements (${item.stock})`);
  check(await p.getByText("Running low:", { exact: false }).count() === 1, "running low is shown");
  await p.getByLabel("Item", { exact: true }).selectOption({ label: `QA Chalk ${stamp}` });
  await p.getByLabel("What").selectOption("issued"); await p.getByLabel("How many").fill("9");
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByText("Not enough in stock", { exact: false }).waitFor({ timeout: 20000 });
  check(true, "issuing more than the stock is refused");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  const { data: hs } = await admin.from("hostel").select("id").eq("school_id", SCHOOL).like("name", "QA House%");
  for (const h of hs ?? []) {
    const { data: rs } = await admin.from("hostel_room").select("id").eq("hostel_id", h.id);
    for (const r of rs ?? []) await admin.from("hostel_allocation").delete().eq("room_id", r.id);
    await admin.from("hostel").delete().eq("id", h.id);
  }
  const { data: its } = await admin.from("inventory_item").select("id").eq("school_id", SCHOOL).like("name", "QA Chalk%");
  for (const i of its ?? []) { await admin.from("inventory_move").delete().eq("item_id", i.id); await admin.from("inventory_item").delete().eq("id", i.id); }
  if (made.user) { await admin.from("profile").delete().eq("id", made.user); await admin.auth.admin.deleteUser(made.user); }
  if (made.staff) await admin.from("staff").delete().eq("id", made.staff);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
