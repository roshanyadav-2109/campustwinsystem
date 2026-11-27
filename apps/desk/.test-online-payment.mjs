// End-to-end test of online fee payment on Greenfield (8) with the built-in
// test gateway: the office adds it and switches it on; a parent pays one bill
// (receipt, bill paid, marked TEST, not posted to Finance) and cancels another
// (bill unchanged); the office sees both; the webhook endpoint refuses
// unknown gateways. Restores everything. Run from apps/desk: node .test-online-payment.mjs
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
const made = { users: [], staff: null, invoices: [] };
const until = async (fn) => { for (let i = 0; i < 20; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 1000)); } return null; };

async function login(email, profile) {
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true });
  made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, ...profile });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  return jar;
}
const cookies = (jar) => jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" }));

const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { count: before } = await admin.from("payment_gateway").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  if (before) throw new Error("Greenfield already has payment gateways; refusing to touch them");
  // a child with a parent, and two QA bills
  const { data: gs } = await admin.from("guardian_student").select("guardian_id, student_id").eq("school_id", SCHOOL).limit(1).single();
  const { data: en } = await admin.from("student_enrollment").select("section_id, academic_year_id").eq("student_id", gs.student_id).order("academic_year_id", { ascending: false }).limit(1).single();
  for (const [title, amount] of [[`QA online ${stamp}`, 1234], [`QA cancel ${stamp}`, 777]]) {
    const { data: inv } = await admin.from("fee_invoice").insert({ school_id: SCHOOL, student_id: gs.student_id, section_id: en.section_id, academic_year_id: en.academic_year_id, title, amount, paid_amount: 0, due_date: "2026-12-31", status: "due" }).select("id").single();
    made.invoices.push(inv.id);
  }

  // 1. the office adds the test gateway and switches it on
  const email = `qa-pay-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Pay Office (temporary)", email, role: "office" }).select("id").single();
  made.staff = st.id;
  const octx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await octx.addCookies(cookies(await login(email, { role: "staff", full_name: "QA Pay Office (temporary)", school_id: SCHOOL, staff_id: st.id })));
  const op = await octx.newPage(); op.on("pageerror", (e) => errors.push(e.message));
  await op.goto(`${HOST}/dashboard/settings/payments`, { waitUntil: "networkidle" });
  await op.getByLabel("Add a gateway").selectOption("test");
  await op.getByRole("button", { name: "Add gateway" }).click();
  await op.getByRole("button", { name: "Use for parents" }).waitFor({ timeout: 20000 });
  await op.getByRole("button", { name: "Use for parents" }).click();
  await op.getByText("Online payment is on.", { exact: false }).waitFor({ timeout: 20000 });
  check(true, "the office added the test gateway and switched it on");

  // 2. the parent pays one bill
  const pctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await pctx.addCookies(cookies(await login(`qa-pay-parent-${stamp}@example.com`, { role: "guardian", full_name: "QA Parent (temporary)", school_id: SCHOOL, guardian_id: gs.guardian_id })));
  const pp = await pctx.newPage(); pp.on("pageerror", (e) => errors.push(e.message));
  await pp.goto(`${HOST}/dashboard/fees?child=${gs.student_id}`, { waitUntil: "networkidle" });
  check(await pp.getByText("testing online payment", { exact: false }).count() === 1, "the parent is told it is a test (no real money)");
  await pp.getByRole("button", { name: "Pay ₹1,234.00" }).or(pp.getByRole("button", { name: /^Pay .*1,234/ })).first().click();
  await pp.getByText("Test gateway: no real money").waitFor({ timeout: 30000 });
  check(true, "the payer reaches the gateway page");
  await pp.getByRole("button", { name: /\(test\)$/ }).click();
  await pp.getByText("Payment received").waitFor({ timeout: 30000 });
  check(await pp.getByText(/Receipt R-\d{4}-\d+/).count() === 1, "the payer sees the receipt number");
  const inv1 = await until(async () => { const { data } = await admin.from("fee_invoice").select("status, paid_amount").eq("id", made.invoices[0]).single(); return data.status === "paid" ? data : null; });
  check(inv1?.status === "paid" && Number(inv1.paid_amount) === 1234, "the bill is paid");
  const { data: fp } = await admin.from("fee_payment").select("mode, is_test, fin_voucher_id, note").eq("invoice_id", made.invoices[0]).single();
  check(fp.mode === "online" && fp.is_test && fp.fin_voucher_id === 0 && fp.note.startsWith("TEST"), "the receipt is marked TEST and kept out of Finance");

  // 3. the parent cancels the other one: nothing changes
  await pp.goto(`${HOST}/dashboard/fees?child=${gs.student_id}`, { waitUntil: "networkidle" });
  await pp.getByRole("button", { name: /^Pay .*777/ }).first().click();
  await pp.getByText("Test gateway: no real money").waitFor({ timeout: 30000 });
  await pp.getByRole("button", { name: "Cancel" }).click();
  await pp.getByText("Payment not completed").waitFor({ timeout: 30000 });
  const { data: inv2 } = await admin.from("fee_invoice").select("status, paid_amount").eq("id", made.invoices[1]).single();
  check(inv2.status === "due" && Number(inv2.paid_amount) === 0, "a cancelled payment leaves the bill unchanged");
  // a forged link to the test gateway is refused
  const { data: ord } = await admin.from("payment_order").select("public_id").eq("invoice_id", made.invoices[1]).limit(1).single();
  await pp.goto(`${HOST}/dashboard/fees/pay/test/${ord.public_id}?s=00000000000000000000000000000000`, { waitUntil: "networkidle" });
  check(!pp.url().includes("/pay/test/"), "a forged test-gateway link is refused");

  // 4. the office sees both
  await op.goto(`${HOST}/dashboard/settings/payments`, { waitUntil: "networkidle" });
  check(await op.getByRole("cell", { name: "Paid" }).count() >= 1 && await op.getByRole("cell", { name: "Failed" }).count() >= 1, "the office sees the paid and the cancelled payment");

  // 5. webhooks for gateways without a connector are refused
  const wh = await fetch(`${HOST}/api/payments/webhook/nonexistent`, { method: "POST", body: "{}" });
  check(wh.status === 404, `unknown gateway webhooks are refused (${wh.status})`);
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  failures++; console.log("FAIL", e.message ?? e);
} finally {
  const { data: orders } = await admin.from("payment_order").select("id, fee_payment_id").eq("school_id", SCHOOL);
  const payIds = (orders ?? []).map((o) => o.fee_payment_id).filter(Boolean);
  await admin.from("payment_order").delete().eq("school_id", SCHOOL);
  await admin.from("payment_event").delete().eq("school_id", SCHOOL);
  if (made.invoices.length) {
    const { data: pays } = await admin.from("fee_payment").select("id").in("invoice_id", made.invoices);
    const ids = [...new Set([...(pays ?? []).map((p) => p.id), ...payIds])];
    if (ids.length) {
      await admin.from("notification_outbox").delete().eq("event_key", "fee_receipt").in("ref_id", ids);
      const { error } = await admin.from("fee_payment").delete().in("id", ids); if (error) console.log("cleanup payments:", error.message);
    }
    await admin.from("notification").delete().eq("school_id", SCHOOL).eq("event_key", "fee_receipt").eq("student_id", (await admin.from("fee_invoice").select("student_id").eq("id", made.invoices[0]).single()).data?.student_id ?? 0).like("body", "%1,234.00%");
    const { error } = await admin.from("fee_invoice").delete().in("id", made.invoices); if (error) console.log("cleanup invoices:", error.message);
  }
  await admin.from("payment_gateway").delete().eq("school_id", SCHOOL);
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  if (made.staff) { const { error } = await admin.from("staff").delete().eq("id", made.staff); if (error) console.log("cleanup staff:", error.message); }
  const { count: g } = await admin.from("payment_gateway").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  const { count: o } = await admin.from("payment_order").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  console.log("restored: Greenfield gateways", g, "orders", o);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
