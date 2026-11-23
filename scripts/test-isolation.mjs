// =============================================================================
// Cross-tenant isolation test. Proves no authenticated user can see or write
// another institution's rows. Runs over the real auth + PostgREST APIs against
// whatever .env.local points at (staging). Sets up a throwaway second
// institution, checks, and tears it down. Exit non-zero on any failure — this
// is the gate the deploy pipeline runs before shipping.
//   node scripts/test-isolation.mjs
// =============================================================================
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => l.trim() && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const REST = `${URL}/rest/v1`;
const AUTH = `${URL}/auth/v1`;

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failed++; };

// admin = service role (bypasses RLS)
const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
async function adminSelect(path) {
  const r = await fetch(`${REST}/${path}`, { headers: adminHeaders });
  if (!r.ok) throw new Error(`admin GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function adminInsert(table, row, prefer = "return=representation") {
  const r = await fetch(`${REST}/${table}`, { method: "POST", headers: { ...adminHeaders, Prefer: prefer }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`admin INSERT ${table} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function adminDelete(path) {
  const r = await fetch(`${REST}/${path}`, { method: "DELETE", headers: adminHeaders });
  if (!r.ok) throw new Error(`admin DELETE ${path} -> ${r.status} ${await r.text()}`);
}
async function createUser(email, password) {
  const r = await fetch(`${AUTH}/admin/users`, { method: "POST", headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!r.ok) throw new Error(`createUser ${email} -> ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}
async function deleteUser(id) {
  await fetch(`${AUTH}/admin/users/${id}`, { method: "DELETE", headers: adminHeaders });
}
async function signIn(email, password) {
  const r = await fetch(`${AUTH}/token?grant_type=password`, { method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`signIn ${email} -> ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
// user = authenticated (subject to RLS)
function userHeaders(tok) { return { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }; }
async function userCount(tok, path) {
  const r = await fetch(`${REST}/${path}`, { headers: { ...userHeaders(tok), Prefer: "count=exact", Range: "0-0" } });
  const cr = r.headers.get("content-range") || "";
  return Number((cr.split("/")[1]) || 0);
}

const PW = "Test-Isolation-1";
let schoolB, staffB, studentB, userBId, userAId, studentA;

try {
  console.log("--- setup: second institution (B) ---");
  const [schoolBRow] = await adminInsert("school", { name: "Isolation Test College B", code: `ITCB-${Date.now()}` });
  schoolB = schoolBRow.id;
  ok(schoolB > 1, `created school B (id ${schoolB})`);

  // A real class/section must exist for B so a student row is valid.
  const [classB] = await adminInsert("class", { name: "ITCB-I", level: 101, stage: "foundational", school_id: schoolB });
  const [sectionB] = await adminInsert("section", { class_id: classB.id, name: "A", school_id: schoolB });
  const [yearB] = await adminInsert("academic_year", { name: `ITCB-${Date.now()}`, start_date: "2025-04-01", end_date: "2026-03-31", is_current: true, school_id: schoolB });
  [studentB] = await adminInsert("student", { full_name: "Student B One", admission_no: `B-${Date.now()}`, gender: "other", dob: "2015-01-01", school_id: schoolB });
  [staffB] = await adminInsert("staff", { full_name: "Teacher B", employee_code: `EB-${Date.now()}`, role: "principal", school_id: schoolB });

  // A user in institution B.
  userBId = await createUser(`teacherB-${Date.now()}@itcb.demo`, PW);
  await adminInsert("profile", { id: userBId, role: "staff", full_name: "Teacher B", staff_id: staffB.id, school_id: schoolB });
  const tokB = await signIn((await (await fetch(`${AUTH}/admin/users/${userBId}`, { headers: adminHeaders })).json()).email, PW);

  // institution A principal (existing).
  const tokA = await signIn("principal@kv.demo", "kviit@demo1");

  console.log("\n--- counts ---");
  const aStudents = await userCount(tokA, "student?select=id");
  const bStudents = await userCount(tokB, "student?select=id");
  console.log(`  A sees ${aStudents} students, B sees ${bStudents}`);
  ok(aStudents > 1000, "A (school 1) still sees its full roster");
  ok(bStudents === 1, "B sees exactly its 1 student (not A's thousands)");

  console.log("\n--- cross-tenant READ must return nothing ---");
  const aSeesB = await userCount(tokA, `student?select=id&id=eq.${studentB.id}`);
  const bSeesA = await userCount(tokB, "student?select=id&school_id=eq.1");
  ok(aSeesB === 0, "A cannot see B's student by id");
  ok(bSeesA === 0, "B cannot see any of A's (school_id=1) students");

  console.log("\n--- cross-tenant WRITE must be blocked ---");
  // B tries to insert a student stamped into school 1.
  const r1 = await fetch(`${REST}/student`, { method: "POST", headers: { ...userHeaders(tokB), Prefer: "return=representation" },
    body: JSON.stringify({ full_name: "Intruder", admission_no: `X-${Date.now()}`, gender: "other", dob: "2015-01-01", school_id: 1 }) });
  ok(!r1.ok, `B inserting a row into school 1 is rejected (HTTP ${r1.status})`);
  // B tries to UPDATE one of A's students.
  const r2 = await fetch(`${REST}/student?school_id=eq.1&limit=1`, { method: "PATCH", headers: userHeaders(tokB),
    body: JSON.stringify({ full_name: "Hacked" }) });
  const r2n = r2.ok ? (await adminSelect(`student?select=full_name&full_name=eq.Hacked`)).length : 0;
  ok(r2n === 0, "B cannot update any of A's students");

  console.log("\n--- SECURITY DEFINER functions (RPC) must not leak across institutions ---");
  // A's current year, and one of A's students, resolved as admin.
  const [aYearRow] = await adminSelect("academic_year?select=id&school_id=eq.1&is_current=eq.true");
  const aYear = aYearRow.id;
  const [aStudentRow] = await adminSelect("student?select=id&school_id=eq.1&limit=1");
  const aStudent = aStudentRow.id;
  const [bYearRow] = await adminSelect(`academic_year?select=id&school_id=eq.${schoolB}&is_current=eq.true`);
  const bYear = bYearRow.id;

  async function rpc(tok, fn, args) {
    const r = await fetch(`${REST}/rpc/${fn}`, { method: "POST", headers: userHeaders(tok), body: JSON.stringify(args) });
    if (!r.ok) return { httpError: r.status };
    return r.json();
  }
  // Positive: A's principal gets A's own school_overview (proves the app path still works).
  const aOwn = await rpc(tokA, "school_overview", { p_year: aYear });
  ok(Array.isArray(aOwn) && Number(aOwn[0]?.students) > 1000, "A's principal sees A's own school_overview");
  // Negative: B's principal passing A's year gets nothing.
  const bPeekOverview = await rpc(tokB, "school_overview", { p_year: aYear });
  ok(Array.isArray(bPeekOverview) && bPeekOverview.length === 0, "B cannot read A's school_overview by passing A's year");
  const bPeekClasses = await rpc(tokB, "class_overview", { p_year: aYear });
  ok(Array.isArray(bPeekClasses) && bPeekClasses.length === 0, "B cannot read A's class_overview by passing A's year");
  const bPeekStanding = await rpc(tokB, "student_standing", { p_student: aStudent, p_year: aYear });
  ok(Array.isArray(bPeekStanding) && bPeekStanding.length === 0, "B cannot read A's student_standing by passing A's student");
  const bPeekReport = await rpc(tokB, "school_report_summary", { p_year: aYear, p_start: "2025-04-01", p_end: "2026-03-31" });
  ok(Array.isArray(bPeekReport) && bPeekReport.length === 0, "B cannot read A's school_report_summary by passing A's year");
  // B's own school_overview still resolves (no leak, just its own small/empty data).
  const bOwn = await rpc(tokB, "school_overview", { p_year: bYear });
  ok(Array.isArray(bOwn) && bOwn.length === 1, "B's principal gets its own school_overview row");
} catch (e) {
  console.error("ERROR:", e.message); failed++;
} finally {
  console.log("\n--- teardown ---");
  try {
    if (userBId) await deleteUser(userBId);
    if (schoolB) {
      // children first
      for (const t of ["profile","student","staff","section","class","academic_year"])
        await adminDelete(`${t}?school_id=eq.${schoolB}`).catch(() => {});
      await adminDelete(`school?id=eq.${schoolB}`).catch(() => {});
    }
    console.log("  cleaned up test institution B");
  } catch (e) { console.log("  teardown note:", e.message); }
}

console.log(`\n${failed === 0 ? "ALL ISOLATION CHECKS PASSED" : failed + " CHECK(S) FAILED"}`);
process.exit(failed === 0 ? 0 : 1);
