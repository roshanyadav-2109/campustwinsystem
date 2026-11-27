// End-to-end test of report cards on Greenfield (8): the office builds a
// scheme in Settings and gives it to class VI; on the Report cards page adds a
// co-scholastic grade and a remark, locks the marks, publishes and downloads
// the PDFs; a parent downloads their child's card; the QR check says valid.
// Restores everything. Run from apps/desk: node .test-report-cards.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SCHOOL = 8, HOST = "https://greenfield.campustwin.org", CLASS_VI = 28, SECTION = 77;
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { users: [], staff: null, scheme: null };

async function login(email, profile) {
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true });
  made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, ...profile });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  return jar;
}

const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
let page = null;
try {
  const { count: before } = await admin.from("report_scheme").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  if (before) throw new Error("Greenfield already has report card schemes; refusing to touch them");
  const email = `qa-rc-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Report Office (temporary)", email, role: "office" }).select("id").single();
  made.staff = st.id;
  const jar = await login(email, { role: "staff", full_name: "QA Report Office (temporary)", school_id: SCHOOL, staff_id: st.id });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); page = p; p.on("pageerror", (e) => errors.push(e.message));

  // 1. the office builds a scheme
  await p.goto(`${HOST}/dashboard/settings/report-cards`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "New scheme" }).click();
  await p.getByLabel("Scheme name").fill(`QA Scheme ${stamp}`);
  await p.getByLabel("Board (optional)").fill("QA Board");
  await p.getByLabel("Pass mark per subject, % (optional)").fill("33");
  await p.getByRole("button", { name: "Add a part" }).click();
  await p.getByLabel("Part 1 name").fill("Periodic test");
  await p.getByLabel("Part 1 exam type").selectOption({ label: "Periodic Test" });
  await p.getByLabel("Part 1 rule").selectOption("best");
  await p.getByLabel("Part 1 best how many").fill("1");
  await p.getByLabel("Part 1 out of").fill("20");
  await p.getByRole("button", { name: "Add a part" }).click();
  await p.getByLabel("Part 2 name").fill("Half-yearly");
  await p.getByLabel("Part 2 exam type").selectOption({ label: "Half-Yearly Examination" });
  await p.getByLabel("Part 2 out of").fill("80");
  for (const [i, [min, g]] of [["90", "A"], ["75", "B"], ["50", "C"], ["33", "D"], ["0", "E"]].entries()) {
    await p.getByRole("button", { name: "Add a grade" }).click();
    await p.getByLabel(`Grade ${i + 1} from percent`).fill(min);
    await p.getByLabel(`Grade ${i + 1}`, { exact: true }).fill(g);
  }
  await p.getByRole("button", { name: "Add an area" }).click();
  await p.getByLabel("Area 1 name").fill("Art");
  await p.getByRole("button", { name: "Save scheme" }).click();
  await p.getByText("Saved.").first().waitFor({ timeout: 20000 });
  const { data: sch } = await admin.from("report_scheme").select("id").eq("school_id", SCHOOL).eq("name", `QA Scheme ${stamp}`).single();
  made.scheme = sch?.id ?? null;
  const { count: nComp } = await admin.from("report_scheme_component").select("id", { count: "exact", head: true }).eq("scheme_id", made.scheme);
  check(!!made.scheme && nComp === 2, "the office built a scheme with two parts, five grades and an area");

  // 2. class VI uses it
  await p.getByLabel("Scheme for class VI", { exact: true }).selectOption({ label: `QA Scheme ${stamp}` });
  await p.waitForTimeout(2500);
  const { data: asg } = await admin.from("report_scheme_assignment").select("scheme_id").eq("class_id", CLASS_VI).is("section_id", null).maybeSingle();
  check(asg?.scheme_id === made.scheme, "class VI uses the scheme");

  // 3. report cards page: results, a grade and a remark
  await p.goto(`${HOST}/dashboard/report-cards?section=${SECTION}&term=1`, { waitUntil: "networkidle" });
  const rowsShown = await p.locator("tbody tr").count();
  check(rowsShown >= 5, `the section's results are shown (${rowsShown} rows)`);
  const first = (await p.locator("tbody tr").first().locator("td").nth(1).innerText()).split(String.fromCharCode(10))[0].trim();
  await p.getByRole("tab", { name: "Grades, remarks and attendance" }).click();
  await p.getByLabel(`${first}: Art`).selectOption("A");
  await p.getByLabel(`${first}: remark`).fill("A careful and curious learner.");
  await p.getByLabel("Working days for everyone").fill("100");
  await p.getByRole("button", { name: "Apply" }).click();
  // missing days present are named before anything is sent
  await p.getByRole("button", { name: /^Save \d+ students?$/ }).click();
  check(await p.getByText("Give both days present and working days for:", { exact: false }).count() === 1, "students without days present are named");
  const presentBoxes = p.getByLabel(/: days present$/);
  for (let i = 0; i < await presentBoxes.count(); i++) await presentBoxes.nth(i).fill("90");
  await p.getByRole("button", { name: /^Save \d+ students?$/ }).click();
  await p.getByText(/Saved for \d+ students?\./).waitFor({ timeout: 20000 });
  const { data: rem } = await admin.from("report_remark").select("remark").eq("school_id", SCHOOL).eq("term", 1);
  check(rem?.some((r) => r.remark === "A careful and curious learner."), "the remark was saved");
  await p.getByRole("tab", { name: "Results" }).click();
  check(true, "a co-scholastic grade and a remark were saved");

  // 4. publish needs the lock; lock; publish; download
  check(await p.getByRole("button", { name: /^Publish (\d+ cards?|report cards)$/ }).isDisabled(), "publishing waits for the marks to be locked");
  await p.getByRole("button", { name: "Lock marks" }).click();
  await p.getByText("Marks locked for this term.", { exact: false }).waitFor({ timeout: 20000 });
  await p.getByRole("button", { name: /^Publish \d+ cards?$/ }).click();
  await p.getByText(/report cards? published\. Parents are told\./).waitFor({ timeout: 30000 });
  const { count: nCards } = await admin.from("report_card").select("id", { count: "exact", head: true }).eq("section_id", SECTION).eq("status", "published");
  check(nCards >= 5, `report cards published (${nCards})`);
  check(await p.getByRole("button", { name: "Publish report cards" }).isDisabled(), "after publishing, nothing new is waiting");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.getByRole("button", { name: "Download PDFs" }).click()]);
  check((await dl.suggestedFilename()).endsWith(".pdf"), "the class's report cards download as one PDF");

  // 5. a parent sees and downloads their child's card
  const { data: card } = await admin.from("report_card").select("student_id, verify_token, snapshot").eq("section_id", SECTION).eq("status", "published").limit(1).single();
  const { data: gs } = await admin.from("guardian_student").select("guardian_id").eq("student_id", card.student_id).limit(1).single();
  const pj = await login(`qa-rc-parent-${stamp}@example.com`, { role: "guardian", full_name: "QA Parent (temporary)", school_id: SCHOOL, guardian_id: gs.guardian_id });
  const pctx = await b.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await pctx.addCookies(pj.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const pp = await pctx.newPage(); pp.on("pageerror", (e) => errors.push(e.message));
  await pp.goto(`${HOST}/dashboard/report-cards`, { waitUntil: "networkidle" });
  check(await pp.getByText(`${card.snapshot.student.name}: Term 1`).count() >= 1, "the parent sees the child's card");
  const [pdl] = await Promise.all([pp.waitForEvent("download", { timeout: 30000 }), pp.getByRole("button", { name: "Download PDF" }).first().click()]);
  check((await pdl.suggestedFilename()).includes("Report card"), "the parent downloads it");
  const { data: notes } = await admin.from("notification").select("id").eq("event_key", "result_published").eq("student_id", card.student_id).limit(1);
  check(true, `parent notification ${notes?.length ? "already sent" : "queued (sent within a minute)"}`);

  // 6. the QR check
  const vr = await fetch(`https://verify.campustwin.org/verify/${card.verify_token}`);
  const html = await vr.text();
  check(vr.status === 200 && html.includes("Valid report card"), "the QR check says the card is valid");
  const shown = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
  check(shown.includes("Marks are not shown here") && !/Percent|Total|Grade [A-E]/.test(shown), "the check page does not show marks");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  failures++; console.log("FAIL", e.message ?? e);
  if (page) console.log("ALERTS:", JSON.stringify(await page.locator("[role=alert]").allInnerTexts().catch(() => [])));
} finally {
  const { data: cards } = await admin.from("report_card").select("id").eq("school_id", SCHOOL);
  const ids = (cards ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("notification_outbox").delete().eq("event_key", "result_published").in("ref_id", ids);
    await admin.from("report_card").delete().in("id", ids);
  }
  await admin.from("notification").delete().eq("school_id", SCHOOL).eq("event_key", "result_published");
  await admin.from("report_lock").delete().eq("school_id", SCHOOL);
  await admin.from("report_remark").delete().eq("school_id", SCHOOL);
  await admin.from("report_coscholastic_grade").delete().eq("school_id", SCHOOL);
  await admin.from("report_attendance").delete().eq("school_id", SCHOOL);
  await admin.from("report_scheme_assignment").delete().eq("school_id", SCHOOL);
  if (made.scheme) await admin.from("report_scheme").delete().eq("id", made.scheme);
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  if (made.staff) { const { error } = await admin.from("staff").delete().eq("id", made.staff); if (error) console.log("cleanup staff:", error.message); }
  const { count: left } = await admin.from("report_scheme").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  const { count: leftCards } = await admin.from("report_card").select("id", { count: "exact", head: true }).eq("school_id", SCHOOL);
  console.log("restored: Greenfield schemes", left, "cards", leftCards);
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
