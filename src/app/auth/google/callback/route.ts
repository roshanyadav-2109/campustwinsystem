import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeNext } from "@/lib/safe-next";
import { cookieDomainForHost } from "@/lib/supabase/cookie-domain";
import { isOwnerEmail } from "@/lib/owner";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

type Saved = { state: string; nonce: string; next: string; origin?: string };

// Where to send the signed-in user back to. Only the base domain, its campus
// subdomains, or the current host are trusted; anything else falls back to here.
function returnOrigin(saved: Saved | null, reqOrigin: string): string {
  const o = saved?.origin;
  if (!o) return reqOrigin;
  try {
    const u = new URL(o);
    const h = u.hostname.toLowerCase();
    if (h === BASE || h.endsWith("." + BASE)) return u.origin;
  } catch { /* ignore */ }
  return reqOrigin;
}
type GoogleClaims = { email?: string; email_verified?: boolean; name?: string; aud?: string };
type Kind = "staff" | "guardian" | "student";
type SchoolRecord = { kind: Kind; id: number; name: string; schoolId: number; otherGuardianIds: number[] };
type Admin = ReturnType<typeof createAdminClient>;

const LINK_COLUMN = { staff: "staff_id", guardian: "guardian_id", student: "student_id" } as const;

// Step 2 of "Continue with Google": Google sends the person back here with a
// one-time code. We swap it (with our secret) for Google's signed ID token and
// hand that to Supabase, which checks Google's signature and opens the session.
//
// Access follows the email on the school's records, worked out afresh at every
// sign-in: whichever staff, parent or student record holds this Google email
// is the account they get. The login for that record is created the first time,
// re-pointed if the office changed the record's email, and taken off any other
// record that used to hold the email. No record with this email: no entry.
export async function GET(request: NextRequest) {
  const cookieDomain = cookieDomainForHost(request.headers.get("host"));
  const clearOauth = { name: "g_oauth", path: "/auth/google", ...(cookieDomain ? { domain: cookieDomain } : {}) };

  let saved: Saved | null = null;
  try { saved = JSON.parse(request.cookies.get("g_oauth")?.value ?? "null"); } catch { saved = null; }

  const fail = (code: string, detail?: string) => {
    if (detail) console.error("[gcb]", code, detail);
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, returnOrigin(saved, request.nextUrl.origin)));
    res.cookies.delete(clearOauth);
    return res;
  };
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  if (!saved || !code || params.get("state") !== saved.state) return fail("google_failed", "state/code mismatch");

  // Code -> ID token, straight from Google over TLS.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: new URL("/auth/google/callback", request.nextUrl.origin).toString(),
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!tokenRes.ok || !tokens.id_token) return fail("google_failed", `token ${tokenRes.status} ${tokens.error ?? ""} ${(tokens.error_description ?? "").slice(0, 60)}`);

  const claims = readClaims(tokens.id_token);
  const email = claims?.email?.trim().toLowerCase();
  if (!email || !claims?.email_verified || claims.aud !== process.env.GOOGLE_CLIENT_ID) return fail("google_failed", `claims v=${claims?.email_verified} audMatch=${claims?.aud === process.env.GOOGLE_CLIENT_ID}`);

  // Platform owner (company console): no school record required. If the email is
  // on the owner allowlist, open a session and send them to the console.
  if (await isOwnerEmail(email)) {
    const admin = createAdminClient();
    // Self-signup is disabled on this project, so signInWithIdToken would 422 for
    // a brand-new owner. Provision the auth user via admin first (ignore "already
    // exists"); then the sign-in matches an existing user instead of signing up.
    await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { platform_owner: true } });
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: tokens.id_token, nonce: saved.nonce });
    if (error) return fail("google_failed", `ownersignin ${error.status ?? ""} ${(error.message ?? "").slice(0, 80)}`);
    const nx = safeNext(saved.next);
    const res = NextResponse.redirect(new URL(nx === "/" ? "/console" : nx, returnOrigin(saved, request.nextUrl.origin)));
    res.cookies.delete(clearOauth);
    return res;
  }

  const admin = createAdminClient();
  const record = await findRecord(admin, email);
  if (!record) {
    // Not on any school's records: an employee in Eternity HR may still sign in
    // (shop, hospital or school staff kept only in HR). Their HR employee record
    // holds the email; it gets a login the first time, linked by the database.
    const hrLogin = (await hrEmployeeLogin(email, claims.name)) ?? (await eternityLogin(email)) ?? (await alumniLogin(email, claims.name));
    if (!hrLogin) return fail("google_not_registered");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithIdToken({ provider: "google", token: tokens.id_token, nonce: saved.nonce });
    if (error || data.user?.id !== hrLogin) {
      await supabase.auth.signOut();
      return fail("google_failed", `hrsignin ${error?.status ?? ""} ${(error?.message ?? "").slice(0, 80)}`);
    }
    const res = NextResponse.redirect(new URL(safeNext(saved.next), returnOrigin(saved, request.nextUrl.origin)));
    res.cookies.delete(clearOauth);
    return res;
  }

  const loginId = await loginForRecord(admin, record, email, claims.name);
  if (!loginId) return fail("google_failed");
  if (record.kind === "guardian") await gatherChildren(admin, record);

  // Nobody else may keep this Google account or email, so Supabase links the
  // Google sign-in to exactly this record's login.
  await admin.rpc("release_login_email" as never, { p_email: email, p_keep: loginId } as never);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: "google", token: tokens.id_token, nonce: saved.nonce });
  if (error || data.user?.id !== loginId) {
    await supabase.auth.signOut();
    return fail("google_failed");
  }

  const res = NextResponse.redirect(new URL(safeNext(saved.next), returnOrigin(saved, request.nextUrl.origin)));
  res.cookies.delete(clearOauth);
  return res;
}

// The ID token came directly from Google's token endpoint over TLS in exchange
// for our secret, so its payload can be read as-is here; Supabase verifies the
// signature itself when it opens the session.
function readClaims(idToken: string): GoogleClaims | null {
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// The school record holding this email. Staff first, then parent, then student,
// so a teacher who is also a parent lands on their staff dashboard. A parent
// whose email is on more than one parent record (one per child, say) gets the
// one that already has a login, or the earliest.
async function findRecord(admin: Admin, email: string): Promise<SchoolRecord | null> {
  const exact = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const [{ data: staff }, { data: guardians }, { data: students }] = await Promise.all([
    admin.from("staff").select("id, full_name, school_id").ilike("email", exact).order("id"),
    admin.from("guardian").select("id, full_name, school_id").ilike("email", exact).order("id"),
    admin.from("student").select("id, full_name, school_id").ilike("email", exact).order("id"),
  ]);
  if (staff?.length) return { kind: "staff", id: staff[0].id, name: staff[0].full_name, schoolId: staff[0].school_id, otherGuardianIds: [] };
  if (guardians?.length) {
    const ids = guardians.map((g) => g.id);
    const { data: linked } = await admin.from("profile").select("guardian_id").in("guardian_id", ids);
    const chosen = guardians.find((g) => linked?.some((l) => l.guardian_id === g.id)) ?? guardians[0];
    return { kind: "guardian", id: chosen.id, name: chosen.full_name, schoolId: chosen.school_id, otherGuardianIds: ids.filter((i) => i !== chosen.id) };
  }
  if (students?.length) return { kind: "student", id: students[0].id, name: students[0].full_name, schoolId: students[0].school_id, otherGuardianIds: [] };
  return null;
}

// The login (auth user) for this record, with this email on it. Uses the
// record's existing login when it has one — changing its email if the office
// has since changed the record's — or creates one. Returns its id, or null.
async function loginForRecord(admin: Admin, record: SchoolRecord, email: string, googleName?: string): Promise<string | null> {
  const column = LINK_COLUMN[record.kind];
  const { data: profile } = await admin.from("profile").select("id").eq(column, record.id).maybeSingle();

  if (profile) {
    const { data: got } = await admin.auth.admin.getUserById(profile.id);
    if (got.user && (got.user.email ?? "").toLowerCase() !== email) {
      await admin.rpc("release_login_email" as never, { p_email: email, p_keep: profile.id } as never);
      const { error } = await admin.auth.admin.updateUserById(profile.id, { email, email_confirm: true });
      if (error) return null;
    }
    return profile.id;
  }

  // First sign-in for this record: free the email from any old login, then
  // create the login and link it to the record.
  await admin.rpc("release_login_email" as never, { p_email: email, p_keep: "00000000-0000-0000-0000-000000000000" } as never);
  const name = record.name || googleName || email;
  const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !created.user) return null;
  const { error: profileErr } = await admin.from("profile").insert({
    id: created.user.id,
    role: record.kind,
    full_name: name,
    school_id: record.schoolId,
    staff_id: record.kind === "staff" ? record.id : null,
    guardian_id: record.kind === "guardian" ? record.id : null,
    student_id: record.kind === "student" ? record.id : null,
  });
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return null;
  }
  return created.user.id;
}

// A parent's email on several parent records (often one per child): link every
// one of those children to the record they sign in as, so they see them all.
async function gatherChildren(admin: Admin, record: SchoolRecord) {
  if (!record.otherGuardianIds.length) return;
  const [{ data: others }, { data: mine }] = await Promise.all([
    admin.from("guardian_student").select("student_id").in("guardian_id", record.otherGuardianIds),
    admin.from("guardian_student").select("student_id").eq("guardian_id", record.id),
  ]);
  const have = new Set((mine ?? []).map((l) => l.student_id));
  const missing = [...new Set((others ?? []).map((l) => l.student_id))].filter((s) => !have.has(s));
  if (missing.length) {
    await admin.from("guardian_student").insert(missing.map((student_id) => ({ guardian_id: record.id, student_id, is_primary: false, school_id: record.schoolId })));
  }
}

// Eternity HR: the login for an employee whose email is on an HR employee record
// in an organisation that has HR. Reuses the login the record is already linked
// to; otherwise links an existing login with that email, or creates one. Linking
// a login to the employee also makes it a member of the organisation with HR
// access (done by the database). Returns the login id, or null.
async function hrEmployeeLogin(email: string, googleName?: string): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return null;
  const { createClient: createJs } = await import("@supabase/supabase-js");
  const opts = { auth: { autoRefreshToken: false, persistSession: false } };
  const hr = createJs(url, key, { ...opts, db: { schema: "hr" } });
  const core = createJs(url, key, { ...opts, db: { schema: "core" } });

  const { data: emps, error } = await hr.from("employee").select("id, org_id, user_id").eq("email", email).neq("status", "left");
  if (error || !emps?.length) return null;
  const { data: subs } = await core.from("subscription").select("org_id")
    .in("org_id", [...new Set(emps.map((e) => e.org_id as string))])
    .eq("product_code", "hr").in("status", ["trial", "active", "past_due"]);
  const live = new Set((subs ?? []).map((s) => s.org_id as string));
  const mine = emps.filter((e) => live.has(e.org_id as string));
  if (!mine.length) return null;

  const linked = mine.find((e) => e.user_id)?.user_id as string | undefined;
  if (linked) return linked;

  // Rewriting the email makes the database link an existing login with it.
  const ids = mine.map((e) => e.id as number);
  await hr.from("employee").update({ email }).in("id", ids);
  const { data: again } = await hr.from("employee").select("user_id").in("id", ids).not("user_id", "is", null).limit(1);
  if (again?.[0]?.user_id) return again[0].user_id as string;

  const admin = createAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: googleName ?? email } });
  if (createErr || !created.user) return null;
  const { error: linkErr } = await hr.from("employee").update({ user_id: created.user.id }).in("id", ids);
  if (linkErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return null;
  }
  return created.user.id;
}

// Anyone whose login has been given access to an Eternity product (organisation
// member, Finance or HR team). Decided by the database; returns the login id.
async function eternityLogin(email: string): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return null;
  const { createClient: createJs } = await import("@supabase/supabase-js");
  const core = createJs(url, key, { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "core" } });
  const { data, error } = await core.rpc("login_for_email", { p_email: email });
  return error || !data ? null : (data as string);
}

// Eternity Alumni: a verified alumnus (imported or approved by the alumni
// office) whose record holds this email, in an institution that has Alumni.
// Reuses the linked login, or creates one the first time and links it.
async function alumniLogin(email: string, googleName?: string): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return null;
  const { createClient: createJs } = await import("@supabase/supabase-js");
  const opts = { auth: { autoRefreshToken: false, persistSession: false } };
  const alum = createJs(url, key, { ...opts, db: { schema: "alum" } });
  const { data: recs } = await alum.from("member").select("id, org_id, user_id").eq("email", email).eq("status", "verified");
  if (!recs?.length) return null;
  const live: typeof recs = [];
  for (const r of recs) {
    const { data: ok } = await alum.rpc("subscribed", { p_org: r.org_id });
    if (ok) live.push(r);
  }
  if (!live.length) return null;
  const linked = live.find((r) => r.user_id)?.user_id as string | undefined;
  if (linked) return linked;
  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: googleName ?? email } });
  if (error || !created.user) return null;
  const { error: linkErr } = await alum.from("member").update({ user_id: created.user.id }).in("id", live.map((r) => r.id as number));
  if (linkErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return null;
  }
  return created.user.id;
}
