// Removes every SAMPLE institution created by scripts/seed-sample.mjs: rows in
// dependency order, the school/university records, and their R2 folders.
// Only schools matching BOTH a sample slug and its sample code (and the sample
// university, once it has no campuses left) are touched.
//
//   node scripts/clean-sample.mjs --env .env.production.local
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { AwsClient } from "aws4fetch";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const env = Object.fromEntries(readFileSync(arg("--env", ".env.production.local"), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
const R2_ENDPOINT = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET || "campustwin-media"}`;
const SAMPLE_UNIVERSITIES = ["westbridge"];
const SAMPLE = { greenfield: "GFP", riverside: "RIS", "st-aldric": "SAC", meridian: "MIT", lakeview: "LCA", "westbridge-north": "WBN", "westbridge-city": "WBC", "westbridge-health": "WBH" };

// Children before parents.
const TABLES = [
  "fee_payment", "fee_invoice_line", "fee_invoice", "fee_structure", "fee_head",
  "library_issue", "library_book", "library_setting",
  "admission_followup", "admission_enquiry",
  "transport_alert", "trip_stop_event", "trip_ping", "bus_live", "trip", "student_transport", "bus_assignment", "route_stop", "bus", "route",
  "homework_submission", "homework",
  "mark", "observation", "hpc_input", "monthly_report", "slippage_flag", "assessment", "assessment_type",
  "absence_notice", "leave_application", "attendance_record",
  "payslip", "payroll_run", "staff_salary", "staff_leave", "staff_leave_type",
  "teacher_allotment", "timetable_slot", "timetable_period",
  "guardian_student", "promotion", "student_enrollment", "feedback", "announcement", "event",
  "class_subject", "subject", "section", "class",
  "profile", "guardian", "staff", "student", "academic_year",
];

async function emptyR2(prefix) {
  let token = null, removed = 0;
  do {
    const r = await r2.fetch(`${R2_ENDPOINT}?list-type=2&prefix=${encodeURIComponent(prefix + "/")}${token ? `&continuation-token=${encodeURIComponent(token)}` : ""}`);
    const xml = await r.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] : null;
    let i = 0;
    await Promise.all(Array.from({ length: 16 }, async () => { while (i < keys.length) { const k = keys[i++]; await r2.fetch(`${R2_ENDPOINT}/${k}`, { method: "DELETE" }); removed++; } }));
  } while (token);
  return removed;
}

const { data: found, error } = await db.from("school").select("id, slug, code, name, university_id").in("slug", Object.keys(SAMPLE));
const schools = (found ?? []).filter((s) => SAMPLE[s.slug] === s.code);
if (error) throw error;
const { data: unis } = await db.from("university").select("id, slug").in("slug", SAMPLE_UNIVERSITIES);
const uniSlug = new Map((unis ?? []).map((u) => [u.id, u.slug]));

for (const s of schools ?? []) {
  process.stdout.write(`${s.name} (${s.slug}) … `);
  for (const t of TABLES) {
    const { error: e } = await db.from(t).delete().eq("school_id", s.id);
    if (e && !/does not exist|schema cache|column .*school_id/i.test(e.message)) throw new Error(`${t}: ${e.message}`);
  }
  const { error: e2 } = await db.from("school").delete().eq("id", s.id).eq("code", SAMPLE[s.slug]);
  if (e2) throw new Error(`school: ${e2.message}`);
  const prefix = s.university_id && uniSlug.get(s.university_id) ? `universities/${uniSlug.get(s.university_id)}/campuses/${s.slug}` : `schools/${s.slug}`;
  console.log(`removed, ${await emptyR2(prefix)} files`);
}
for (const u of unis ?? []) {
  const { count } = await db.from("school").select("*", { count: "exact", head: true }).eq("university_id", u.id);
  if (count) { console.log(`${u.slug}: keeps ${count} non-sample campuses, not removed`); continue; }
  await db.from("profile").update({ university_id: null, active_campus_id: null }).eq("university_id", u.id);
  const { error: e } = await db.from("university").delete().eq("id", u.id);
  if (e) throw new Error(`university: ${e.message}`);
  console.log(`${u.slug}: removed, ${await emptyR2(`universities/${u.slug}`)} files`);
}
console.log("Sample data removed.");
