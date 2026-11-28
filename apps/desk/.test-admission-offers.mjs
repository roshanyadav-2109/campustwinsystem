// Admissions offers on Greenfield (8): the office offers a seat and prints the letter; the family opens its
// private link, accepts and pays the application fee on the test gateway. Restores everything.
// Run from apps/desk: node .test-admission-offers.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";
const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const S = 8, HOST = "https://greenfield.campustwin.org";
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { users: [], staff: [], enquiry: null, gateway: null, school: null };
const settle = (p) => p.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { data: sc } = await admin.from("school").select("application_fee, offer_days, auto_waitlist").eq("id", S).single(); made.school = sc;
  await admin.from("school").update({ application_fee: 300 }).eq("id", S);
  const { data: gw } = await admin.from("payment_gateway").select("id").eq("school_id", S).eq("active", true).maybeSingle();
  if (!gw) { const { data: g } = await admin.from("payment_gateway").insert({ school_id: S, provider: "test", label: "QA test", mode: "test", active: true }).select("id").single(); made.gateway = g.id; }
  const { data: yr } = await admin.from("academic_year").select("id").eq("school_id", S).eq("is_current", true).single();
  const { data: cls } = await admin.from("class").select("id").eq("school_id", S).order("level").limit(1).single();
  const { data: enq } = await admin.from("admission_enquiry").insert({ school_id: S, child_name: `QA Offer ${stamp}`, class_id: cls.id, guardian_name: "QA Parent", phone: "9000012345",
    source: "walk_in", status: "applied", academic_year_id: yr.id }).select("id, public_token").single(); made.enquiry = enq.id;

  const email = `qa-ao-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA Office (temporary)", email, role: "office" }).select("id").single(); made.staff.push(st.id);
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Office", school_id: S, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/admissions?id=${enq.id}`, { waitUntil: "load", timeout: 90000 }); await settle(p);
  if (!(await p.getByText("Offer and waiting list").count())) { await p.getByText(`QA Offer ${stamp}`).first().click(); }
  await p.getByRole("button", { name: "Offer a seat" }).click();
  await p.getByText("Seat offered. The family is told.").waitFor({ timeout: 60000 });
  const { data: e1 } = await admin.from("admission_enquiry").select("status, offer_no").eq("id", enq.id).single();
  check(e1.status === "offered" && /^OF-/.test(e1.offer_no ?? ""), `the office offered a seat (${e1.offer_no})`);
  await settle(p);
  await p.getByRole("button", { name: "Offer letter" }).waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.getByRole("button", { name: "Offer letter" }).click()]);
  check((await dl.suggestedFilename()).startsWith("Offer letter"), "the offer letter downloads");

  // the family, not signed in
  const fam = await (await b.newContext({ viewport: { width: 420, height: 900 } })).newPage(); fam.on("pageerror", (e) => errors.push(e.message));
  await fam.goto(`${HOST}/apply/status/${enq.public_token}`, { waitUntil: "load", timeout: 90000 }); await settle(fam);
  check(await fam.getByText("A seat is offered.").count() === 1, "the family's link shows the offer without signing in");
  await fam.getByRole("button", { name: "Accept the seat" }).click();
  await fam.getByText(/The seat is confirmed/).waitFor({ timeout: 60000 });
  await fam.getByRole("button", { name: "Pay online" }).click();
  await fam.getByRole("button", { name: /Pay Rs 300/ }).click({ timeout: 60000 });
  await fam.waitForURL(/\/apply\/status\//, { timeout: 60000 }); await settle(fam);
  check(await fam.getByText("Paid. Thank you.").count() === 1, "the application fee is paid on the test gateway");
  const { data: e2 } = await admin.from("admission_enquiry").select("status, app_fee_paid_on, app_fee_ref").eq("id", enq.id).single();
  check(e2.status === "accepted" && !!e2.app_fee_paid_on && /^TEST/.test(e2.app_fee_ref ?? ""), "the office sees the seat accepted and the fee paid");
  const { count: msgs } = await admin.from("notification").select("id", { count: "exact", head: true }).eq("enquiry_id", enq.id);
  check((msgs ?? 0) >= 2, `the family was messaged at each step (${msgs})`);
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.enquiry) {
    const { data: orders } = await admin.from("payment_order").select("id").eq("enquiry_id", made.enquiry);
    for (const o of orders ?? []) { await admin.from("payment_event").delete().eq("order_id", o.id); await admin.from("payment_order").delete().eq("id", o.id); }
    await admin.from("admission_enquiry").delete().eq("id", made.enquiry);
  }
  if (made.school) await admin.from("school").update(made.school).eq("id", S);
  if (made.gateway) await admin.from("payment_gateway").delete().eq("id", made.gateway);
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) { await admin.from("person_membership").delete().eq("staff_id", s); const { error } = await admin.from("staff").delete().eq("id", s); if (error) console.log("cleanup: staff", error.message); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
