// Transcripts and returns on Meridian (college, 11): NAAC counts, internal marks,
// the university results import, a transcript with its QR check. Restores everything.
// Run from apps/desk: node .test-transcripts.mjs
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
const made = { users: [], staff: [], student: null, sem: null };
const settle = (p) => p.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
const b = await chromium.launch({ executablePath: process.env.LOCALAPPDATA + "/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
const errors = [];
try {
  const email = `qa-tr-${stamp}@example.com`;
  const { data: st } = await admin.from("staff").insert({ school_id: S, full_name: "QA CoE T (temporary)", email, role: "subject_teacher" }).select("id").single(); made.staff.push(st.id);
  const { data: coeT } = await admin.from("position_title").select("id").eq("school_id", S).eq("access_type", "exams_head").in("scope_level", ["campus", "university"]).limit(1).single();
  await admin.from("staff_position").insert({ school_id: S, staff_id: st.id, title_id: coeT.id });
  const { data: cu } = await admin.auth.admin.createUser({ email, email_confirm: true }); made.users.push(cu.user.id);
  await admin.from("profile").insert({ id: cu.user.id, role: "staff", full_name: "QA CoE T", school_id: S, staff_id: st.id });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: v } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const jar = []; await createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: (c) => jar.push(...c) } }).auth.setSession(v.session);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, domain: ".campustwin.org", path: "/", secure: true, sameSite: "Lax" })));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));

  const go = async (path) => { await p.goto(`${HOST}${path}`, { waitUntil: "load", timeout: 90000 }); await settle(p); };

  await go("/dashboard/returns");
  check(await p.getByText("Counts for NAAC and AISHE", { exact: true }).count() === 1, "the returns page shows the NAAC and AISHE counts");
  // a section with marks downloads; one without says so
  const dlP = p.waitForEvent("download", { timeout: 90000 }).then(async (d) => (await d.suggestedFilename()).startsWith("Internal marks")).catch(() => false);
  const noneP = p.getByText("No internal marks for this section yet.").waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
  await p.getByRole("button", { name: "Download CSV" }).click();
  check(await Promise.race([dlP, noneP]), "internal marks export answers (a CSV, or none yet)");

  // a student with no result yet in the latest semester; import two courses from the university
  const { data: sem } = await admin.from("semester").select("id").eq("school_id", S).in("kind", ["odd", "even"]).order("starts_on", { ascending: false }).limit(1).single(); made.sem = sem.id;
  const { data: crs } = await admin.from("course").select("code").eq("school_id", S).not("code", "is", null).order("id").limit(2);
  const { data: enr } = await admin.from("student_enrollment").select("student_id, student:student_id(admission_no)").eq("school_id", S).eq("status", "active").limit(200);
  const { data: had } = await admin.from("course_result").select("student_id").eq("semester_id", sem.id);
  const busy = new Set((had ?? []).map((x) => x.student_id));
  const kid = enr.find((e) => !busy.has(e.student_id)); made.student = kid.student_id;
  const csv = `admission_no,course_code,grade,point,passed\n${kid.student.admission_no},${crs[0].code},A,9,yes\n${kid.student.admission_no},${crs[1].code},B+,8,yes\n`;
  await p.getByLabel("University results file").setInputFiles({ name: "results.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await p.getByText(/Imported \d+ course results/).waitFor({ timeout: 90000 });
  const { data: sr } = await admin.from("semester_result").select("sgpa, published_as").eq("semester_id", sem.id).eq("student_id", kid.student_id).maybeSingle();
  check(sr && Number(sr.sgpa) > 8 && sr.published_as === "Imported from the university", `the university's results are imported (SGPA ${sr?.sgpa})`);

  await go("/dashboard/transcripts");
  await p.getByLabel("Admission number").fill(kid.student.admission_no);
  const [dl2] = await Promise.all([p.waitForEvent("download", { timeout: 90000 }), p.getByRole("button", { name: "Issue and download" }).click()]);
  check((await dl2.suggestedFilename()).startsWith("Transcript"), "the transcript downloads");
  const { data: ti } = await admin.from("transcript_issue").select("id, verify_token").eq("student_id", kid.student_id).order("id", { ascending: false }).limit(1).single();
  const v1 = await ctx.newPage(); await v1.goto(`https://verify.campustwin.org/verify/${ti.verify_token}`, { waitUntil: "load", timeout: 90000 });
  check(await v1.getByText("Transcript on record").count() === 1, "the QR check finds the transcript");
  await settle(p); await p.reload({ waitUntil: "load", timeout: 90000 }); await settle(p);
  await p.getByRole("button", { name: "Withdraw" }).first().click();
  await p.getByText(/Withdrawn\. The QR check/).waitFor({ timeout: 60000 });
  await v1.reload({ waitUntil: "load", timeout: 90000 });
  check(await v1.getByText("This transcript has been withdrawn").count() === 1, "a withdrawn transcript shows as withdrawn");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) { failures++; console.log("FAIL", e.message ?? e); }
finally {
  if (made.student) {
    await admin.from("transcript_issue").delete().eq("student_id", made.student);
    await admin.from("course_result").delete().eq("student_id", made.student).eq("semester_id", made.sem);
    await admin.from("semester_result").delete().eq("student_id", made.student).eq("semester_id", made.sem);
  }
  for (const u of made.users) { await admin.from("profile").delete().eq("id", u); await admin.auth.admin.deleteUser(u); }
  for (const s of made.staff) { await admin.from("staff_position").delete().eq("staff_id", s); await admin.from("staff").delete().eq("id", s); }
  await b.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
}
