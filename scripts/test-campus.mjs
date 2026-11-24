// =============================================================================
// University -> campus access test (migration 0049). Proves:
//  - each campus is isolated (campus-A principal can't see campus-B, vice versa)
//  - a central university admin (profile.university_id set) sees ALL campuses of
//    that university, but NOT other tenants (e.g. school 1)
//  - central admin can write into any of its campuses; a campus principal can't
// Runs over the real auth + PostgREST APIs against whatever .env.local points at
// (staging). Sets up a throwaway SRM university + two campuses, checks, tears down.
//   node scripts/test-campus.mjs
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
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failed++; };
const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
async function adminSelect(p) { const r = await fetch(`${REST}/${p}`, { headers: adminHeaders }); if (!r.ok) throw new Error(`admin GET ${p} -> ${r.status} ${await r.text()}`); return r.json(); }
async function adminInsert(t, row) { const r = await fetch(`${REST}/${t}`, { method: "POST", headers: { ...adminHeaders, Prefer: "return=representation" }, body: JSON.stringify(row) }); if (!r.ok) throw new Error(`admin INSERT ${t} -> ${r.status} ${await r.text()}`); return r.json(); }
async function adminDelete(p) { await fetch(`${REST}/${p}`, { method: "DELETE", headers: adminHeaders }); }
async function createUser(email, password) { const r = await fetch(`${AUTH}/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) }); if (!r.ok) throw new Error(`createUser ${email} -> ${r.status} ${await r.text()}`); return (await r.json()).id; }
async function deleteUser(id) { await fetch(`${AUTH}/admin/users/${id}`, { method: "DELETE", headers: adminHeaders }); }
async function signIn(email, password) { const r = await fetch(`${AUTH}/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); if (!r.ok) throw new Error(`signIn ${email} -> ${r.status} ${await r.text()}`); return (await r.json()).access_token; }
const uh = (tok) => ({ apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" });
async function userCount(tok, p) { const r = await fetch(`${REST}/${p}`, { headers: { ...uh(tok), Prefer: "count=exact", Range: "0-0" } }); return Number((r.headers.get("content-range") || "").split("/")[1] || 0); }

const PW = "Test-Campus-1";
const S = Date.now();
let uni, campusA, campusB, userAId, userBId, userCId, emailA, emailB, emailC;

async function makeCampus(label, slug) {
  const [s] = await adminInsert("school", { name: label, code: `${slug}-${S}`, slug: `${slug}-${S}`, university_id: uni });
  await adminInsert("class", { name: `${slug}-I`, level: 101, stage: "foundational", school_id: s.id });
  await adminInsert("academic_year", { name: `${slug}-${S}`, start_date: "2025-04-01", end_date: "2026-03-31", is_current: true, school_id: s.id });
  const [stu] = await adminInsert("student", { full_name: `${label} Student`, admission_no: `${slug}-${S}`, gender: "other", dob: "2015-01-01", school_id: s.id });
  const [staff] = await adminInsert("staff", { full_name: `${label} Principal`, employee_code: `${slug}P-${S}`, role: "principal", school_id: s.id });
  return { id: s.id, student: stu.id, staff: staff.id };
}

try {
  console.log("--- setup: SRM university + two campuses ---");
  const [u] = await adminInsert("university", { name: "SRM Test University", slug: `srmtest-${S}` });
  uni = u.id;
  ok(uni > 0, `created university (id ${uni})`);
  campusA = await makeCampus("SRM KTR (test)", "srmktr");
  campusB = await makeCampus("SRM RMP (test)", "srmrmp");
  ok(campusA.id !== campusB.id, `created campuses A=${campusA.id} B=${campusB.id}`);

  // campus-A principal
  emailA = `ktr-${S}@srm.demo`; userAId = await createUser(emailA, PW);
  await adminInsert("profile", { id: userAId, role: "staff", full_name: "KTR Principal", staff_id: campusA.staff, school_id: campusA.id });
  // campus-B principal
  emailB = `rmp-${S}@srm.demo`; userBId = await createUser(emailB, PW);
  await adminInsert("profile", { id: userBId, role: "staff", full_name: "RMP Principal", staff_id: campusB.staff, school_id: campusB.id });
  // central SRM admin: home campus A, but university_id set -> cross-campus
  emailC = `central-${S}@srm.demo`; userCId = await createUser(emailC, PW);
  const [centralStaff] = await adminInsert("staff", { full_name: "SRM Central Admin", employee_code: `SRMC-${S}`, role: "principal", school_id: campusA.id });
  await adminInsert("profile", { id: userCId, role: "staff", full_name: "SRM Central Admin", staff_id: centralStaff.id, school_id: campusA.id, university_id: uni });

  // helper: set the central admin's active campus (what the switcher does)
  async function setActiveCampus(campusId) {
    const r = await fetch(`${REST}/profile?id=eq.${userCId}`, { method: "PATCH", headers: { ...adminHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ active_campus_id: campusId }) });
    return r;
  }

  const tokA = await signIn(emailA, PW);
  const tokB = await signIn(emailB, PW);

  console.log("\n--- per-campus isolation ---");
  const aStu = await userCount(tokA, "student?select=id");
  const bStu = await userCount(tokB, "student?select=id");
  ok(aStu === 1, `campus-A principal sees only A's 1 student (saw ${aStu})`);
  ok(bStu === 1, `campus-B principal sees only B's 1 student (saw ${bStu})`);
  const aSeesB = await userCount(tokA, `student?select=id&school_id=eq.${campusB.id}`);
  ok(aSeesB === 0, "campus-A principal cannot see campus-B students");

  console.log("\n--- central admin scopes to its ACTIVE campus (reuses normal pages) ---");
  // No active campus yet -> defaults to home campus A.
  let tokC = await signIn(emailC, PW);
  const cHome = await userCount(tokC, "student?select=id");
  ok(cHome === 1, `central admin (no active set) sees home campus A only (saw ${cHome})`);
  // Switch to campus B -> now scoped to B.
  await setActiveCampus(campusB.id);
  tokC = await signIn(emailC, PW);
  const cOnB = await userCount(tokC, "student?select=id");
  const cOnBisB = await userCount(tokC, `student?select=id&school_id=eq.${campusB.id}`);
  ok(cOnB === 1 && cOnBisB === 1, `after switching, central admin sees campus B only (saw ${cOnB})`);
  const cSeesSchool1 = await userCount(tokC, "student?select=id&school_id=eq.1");
  ok(cSeesSchool1 === 0, "central admin never sees a non-SRM tenant (school 1)");

  console.log("\n--- cross-campus roll-up via RPC + university read ---");
  const rollup = await (await fetch(`${REST}/rpc/university_overview`, { method: "POST", headers: uh(tokC), body: "{}" })).json();
  ok(Array.isArray(rollup) && rollup.length === 2, `university_overview() returns both campuses (got ${Array.isArray(rollup) ? rollup.length : "?"})`);
  const cUni = await userCount(tokC, `university?select=id&id=eq.${uni}`);
  ok(cUni === 1, "central admin can read its university row");

  console.log("\n--- guard: cannot switch into a non-university campus ---");
  const bad = await setActiveCampus(1); // school 1 is not an SRM campus
  ok(!bad.ok, `switching active campus to a non-SRM school is rejected (HTTP ${bad.status})`);
  await setActiveCampus(campusB.id); // restore valid

  console.log("\n--- write scoping: active campus writable, other campus/principal blocked ---");
  tokC = await signIn(emailC, PW); // active = B
  const w1 = await fetch(`${REST}/student`, { method: "POST", headers: { ...uh(tokC), Prefer: "return=representation" },
    body: JSON.stringify({ full_name: "Central-Added", admission_no: `CA-${S}`, gender: "other", dob: "2015-01-01", school_id: campusB.id }) });
  ok(w1.ok, `central admin (active=B) can insert into campus B (HTTP ${w1.status})`);
  const w1x = await fetch(`${REST}/student`, { method: "POST", headers: { ...uh(tokC), Prefer: "return=representation" },
    body: JSON.stringify({ full_name: "WrongCampus", admission_no: `WC-${S}`, gender: "other", dob: "2015-01-01", school_id: campusA.id }) });
  ok(!w1x.ok, `central admin (active=B) cannot write into campus A without switching (HTTP ${w1x.status})`);
  const w2 = await fetch(`${REST}/student`, { method: "POST", headers: { ...uh(tokA), Prefer: "return=representation" },
    body: JSON.stringify({ full_name: "Intruder", admission_no: `IN-${S}`, gender: "other", dob: "2015-01-01", school_id: campusB.id }) });
  ok(!w2.ok, `campus-A principal CANNOT insert into campus B (HTTP ${w2.status})`);
} catch (e) {
  console.error("ERROR:", e.message); failed++;
} finally {
  console.log("\n--- teardown ---");
  try {
    for (const id of [userAId, userBId, userCId]) if (id) await deleteUser(id);
    for (const c of [campusA, campusB]) if (c?.id) {
      for (const t of ["profile","student","staff","academic_year","class"]) await adminDelete(`${t}?school_id=eq.${c.id}`).catch(() => {});
      await adminDelete(`school?id=eq.${c.id}`).catch(() => {});
    }
    if (uni) await adminDelete(`university?id=eq.${uni}`).catch(() => {});
    console.log("  cleaned up SRM test university + campuses");
  } catch (e) { console.log("  teardown note:", e.message); }
}
console.log(`\n${failed === 0 ? "ALL CAMPUS CHECKS PASSED" : failed + " CHECK(S) FAILED"}`);
process.exit(failed === 0 ? 0 : 1);
