// Load check on Meridian (college, 11): requests one page view sets off in a
// real browser, and 20 people opening pages at the same moment (3 rounds).
// Not pass/fail; prints numbers to compare over time. Removes its login.
// Run from apps/desk: node .test-load.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";
const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `qa-load-${Date.now()}@example.com`;
const { data: st } = await admin.from("staff").insert({ school_id: 11, full_name: "QA Load (temporary)", email, role: "office" }).select("id").single();
const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true });
await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Load", school_id: 11, staff_id: st.id });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
try {
  const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
  const ctx = await b.newContext(); await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); let rsc = 0, all = 0;
  p.on("request", (r) => { all++; if (r.url().includes("_rsc=")) rsc++; });
  const t0 = Date.now(); await p.goto("https://meridian.campustwin.org/dashboard", { waitUntil: "load", timeout: 120000 }); const tl = Date.now() - t0;
  await p.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {}); const ti = Date.now() - t0;
  console.log(`browser: load ${tl} ms, settled ${ti} ms, ${all} requests, ${rsc} page preloads`);
  await b.close();
  const cookie = jar.map((c) => `${c.name}=${c.value}`).join("; ");
  for (let round = 1; round <= 3; round++) {
    const times = await Promise.all(Array.from({ length: 20 }, async (_, i) => { const t = Date.now(); const r = await fetch(`https://meridian.campustwin.org/${i % 2 ? "dashboard" : "dashboard/lectures"}`, { headers: { cookie } }); await r.text(); return { ms: Date.now() - t, ok: r.status === 200 }; }));
    const ms = times.map((x) => x.ms).sort((a, b) => a - b);
    console.log(`round ${round}: 20 at once, median ${ms[10]} ms, slowest ${ms[19]} ms, ok ${times.filter((x) => x.ok).length}/20`);
  }
} finally {
  await admin.from("profile").delete().eq("id", cu.user.id); await admin.auth.admin.deleteUser(cu.user.id); await admin.from("staff").delete().eq("id", st.id);
}
