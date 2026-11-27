// End-to-end test of marks in Excel on Greenfield (8), section VI-A, term 1,
// as a temporary office login: download the sheet; upload one with a bad cell
// (nothing saved, the cell is reported); upload a correct one with a number,
// AB and EX; check the marks; the exempt flag shows on the marks screen.
// Restores every mark it touched. Run from apps/desk: node .test-marks-sheet.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const SCHOOL = 8, HOST = "https://greenfield.campustwin.org", SECTION = 77;
const stamp = Date.now().toString().slice(-6);
let failures = 0;
const check = (ok, label) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made = { user: null, staff: null };
let backup = [];

const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const { data: year } = await admin.from("academic_year").select("id").eq("school_id", SCHOOL).eq("is_current", true).single();
  const { data: as } = await admin.from("assessment").select("id, name, max_marks, subject:subject_id(name)").eq("section_id", SECTION).eq("academic_year_id", year.id).eq("term", 1).order("subject_id").limit(2);
  const { data: kids } = await admin.from("student_enrollment").select("student:student_id(id, admission_no)").eq("section_id", SECTION).eq("academic_year_id", year.id).limit(3);
  const [a1, a2] = as; const k = kids.map((x) => x.student);
  const { data: before } = await admin.from("mark").select("*").in("assessment_id", [a1.id, a2.id]).in("student_id", k.map((x) => x.id));
  backup = before ?? [];

  const email = `qa-msheet-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: SCHOOL, full_name: "QA Marks Office (temporary)", email, role: "office" }).select("id").single();
  made.staff = st.id;
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.user = cu.user.id;
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA Marks Office (temporary)", school_id: SCHOOL, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(`${HOST}/dashboard/marks?section=${SECTION}`, { waitUntil: "networkidle" });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.getByRole("button", { name: "Download sheet" }).click()]);
  check((await dl.suggestedFilename()).endsWith(".xlsx"), "the section's term sheet downloads as Excel");

  const h1 = `${a1.subject.name} - ${a1.name} (out of ${Number(a1.max_marks)}) [#${a1.id}]`;
  const h2 = `${a2.subject.name} - ${a2.name} (out of ${Number(a2.max_marks)}) [#${a2.id}]`;
  const max1 = Number(a1.max_marks);
  writeFileSync("D:/tmp/qa-marks-bad.csv", `Admission no,Roll,Name,"${h1}","${h2}"\n${k[0].admission_no},,X,${max1 + 5},\nNOPE${stamp},,Y,1,\n`);
  await p.getByLabel("Filled marks sheet").setInputFiles("D:/tmp/qa-marks-bad.csv");
  await p.getByText("Nothing was saved.", { exact: false }).waitFor({ timeout: 30000 });
  check(await p.getByText(`is more than ${max1}`, { exact: false }).count() === 1, "a mark above the maximum is reported with its row and column");
  check(await p.getByText(`NOPE${stamp} is not in this section`, { exact: false }).count() === 1, "an unknown admission number is reported");

  writeFileSync("D:/tmp/qa-marks-good.csv", `Admission no,Roll,Name,"${h1}","${h2}"\n${k[0].admission_no},,X,${max1 - 1},AB\n${k[1].admission_no},,Y,EX,\n`);
  await p.getByLabel("Filled marks sheet").setInputFiles("D:/tmp/qa-marks-good.csv");
  await p.getByText("3 marks saved.", { exact: false }).waitFor({ timeout: 30000 });
  const { data: after } = await admin.from("mark").select("assessment_id, student_id, marks_obtained, is_absent, is_exempt").in("assessment_id", [a1.id, a2.id]).in("student_id", [k[0].id, k[1].id]);
  const get = (aid, sid) => after.find((m) => m.assessment_id === aid && m.student_id === sid);
  check(Number(get(a1.id, k[0].id)?.marks_obtained) === max1 - 1, "a number was saved");
  check(get(a2.id, k[0].id)?.is_absent === true, "AB saved as absent");
  check(get(a1.id, k[1].id)?.is_exempt === true && get(a1.id, k[1].id)?.marks_obtained == null, "EX saved as exempt");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  failures++; console.log("FAIL", e.message ?? e);
} finally {
  // put every touched mark back exactly
  try {
    const { data: year } = await admin.from("academic_year").select("id").eq("school_id", SCHOOL).eq("is_current", true).single();
    const { data: as } = await admin.from("assessment").select("id").eq("section_id", SECTION).eq("academic_year_id", year.id).eq("term", 1).order("subject_id").limit(2);
    const { data: kids } = await admin.from("student_enrollment").select("student_id").eq("section_id", SECTION).eq("academic_year_id", year.id).limit(3);
    const aIds = as.map((a) => a.id), sIds = kids.map((x) => x.student_id);
    await admin.from("mark").delete().in("assessment_id", aIds).in("student_id", sIds);
    if (backup.length) { const { error } = await admin.from("mark").insert(backup.map(({ id, ...r }) => r)); if (error) console.log("restore marks:", error.message); }
    const { count } = await admin.from("mark").select("id", { count: "exact", head: true }).in("assessment_id", aIds).in("student_id", sIds);
    console.log("restored: marks", count, "of", backup.length);
  } catch (e) { console.log("restore failed", e.message); }
  if (made.user) { await admin.from("profile").delete().eq("id", made.user); await admin.auth.admin.deleteUser(made.user); }
  if (made.staff) { const { error } = await admin.from("staff").delete().eq("id", made.staff); if (error) console.log("cleanup staff:", error.message); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
