// End-to-end test of the digital ID card on Greenfield (8): a parent of a
// child with an issued card sees it with its QR and the child's details; the
// Aadhaar number is never shown in full. Run from apps/desk: node .test-family-id-card.mjs
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
const made = { users: [] };
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { data: card } = await admin.from("id_card").select("student_id, verify_token, student:student_id(full_name)").eq("school_id", SCHOOL).eq("status", "active").limit(1).single();
  const { data: gs } = await admin.from("guardian_student").select("guardian_id").eq("student_id", card.student_id).limit(1).single();
  const email = `qa-idc-parent-${stamp}@example.com`;
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "guardian", full_name: "QA Parent (temporary)", school_id: SCHOOL, guardian_id: gs.guardian_id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${HOST}/dashboard`, { waitUntil: "networkidle" });
  check(await p.getByRole("link", { name: "ID card and details" }).count() >= 1, "the parent's menu has ID card and details");
  await p.goto(`${HOST}/dashboard/id-card`, { waitUntil: "networkidle" });
  check(await p.getByLabel(`ID card of ${card.student.full_name}`).count() === 1, "the child's digital ID card is shown");
  check(await p.getByRole("img", { name: "QR code to check this card" }).count() >= 1, "with its QR code");
  check(await p.getByText("Parents", { exact: true }).count() >= 1 && await p.getByText("Admission no.", { exact: true }).count() >= 1, "the child's details are shown");
  check(!/\b\d{12}\b/.test(await p.locator("main").innerText()), "no full Aadhaar number on the page");
  const html = await (await fetch(`https://verify.campustwin.org/verify/${card.verify_token}`)).text();
  check(html.includes("Valid student ID card"), "the card's QR check says valid");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  failures++; console.log("FAIL", e.message ?? e);
} finally {
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
