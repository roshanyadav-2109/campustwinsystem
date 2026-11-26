// Direct test of Google sign-in matching (src/lib/auth/resolve-login.ts) on
// live sample institutions. Run: npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/arch/test-resolve-login.ts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resolveLogin } from "../../src/lib/auth/resolve-login";

const env = Object.fromEntries(readFileSync("apps/desk/.env.production.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now().toString().slice(-6);
const email = `qa-resolve-${stamp}@example.com`;
let failures = 0;
const check = (ok: boolean, label: string) => { console.log(ok ? "PASS" : "FAIL", label); if (!ok) failures++; };
const made: { staff?: number; guardian?: number; users: string[]; bystander?: string; bystanderStaff?: number } = { users: [] };

async function main() {
  const membersBefore = (await admin.from("person_membership").select("id", { count: "exact", head: true })).count;
  const { data: st } = await admin.from("staff").insert({ school_id: 8, full_name: "QA Resolve (temporary)", email, role: "subject_teacher" }).select("id").single();
  made.staff = st!.id;
  const { data: g } = await admin.from("guardian").insert({ school_id: 12, full_name: "QA Resolve (temporary)", email, relation: "Mother" }).select("id").single();
  made.guardian = g!.id;
  // a bystander login at Greenfield that must not be touched
  const bEmail = `qa-bystander-${stamp}@example.com`;
  const { data: bs } = await admin.from("staff").insert({ school_id: 8, full_name: "QA Bystander", email: bEmail, role: "office" }).select("id").single();
  made.bystanderStaff = bs!.id;
  const { data: bu } = await admin.auth.admin.createUser({ email: bEmail, email_confirm: true }); made.bystander = bu.user!.id;
  await admin.from("profile").insert({ id: bu.user!.id, role: "staff", full_name: "QA Bystander", school_id: 8, staff_id: bs!.id } as never);

  const a = await resolveLogin(admin as never, email, "lakeview");
  check(!!a, "first sign-in from Lakeview resolves");
  if (!a) return;
  made.users.push(a.userId);
  const { data: m1 } = await admin.from("person_membership").select("school_id, role").eq("user_id", a.userId).order("school_id");
  check(JSON.stringify(m1) === JSON.stringify([{ school_id: 8, role: "staff" }, { school_id: 12, role: "guardian" }]), `one login with both memberships (${JSON.stringify(m1)})`);
  const { data: p1 } = await admin.from("profile").select("school_id, role").eq("id", a.userId).single();
  check(p1!.school_id === 12 && p1!.role === "guardian", "opens at Lakeview, the website they signed in from");

  const b = await resolveLogin(admin as never, email, "greenfield");
  check(b?.userId === a.userId, "signing in from Greenfield reuses the same login");
  const { data: p2 } = await admin.from("profile").select("school_id, role").eq("id", a.userId).single();
  check(p2!.school_id === 8 && p2!.role === "staff", "and opens at Greenfield as staff");
  const { count: c2 } = await admin.from("person_membership").select("id", { count: "exact", head: true }).eq("user_id", a.userId);
  check(c2 === 2, "still two memberships, nothing duplicated");

  const { data: by } = await admin.from("profile").select("school_id, staff_id").eq("id", made.bystander!).single();
  const { data: byUser } = await admin.auth.admin.getUserById(made.bystander!);
  check(by!.staff_id === made.bystanderStaff && byUser.user?.email === bEmail, "another person's login at Greenfield is untouched");

  // Lakeview allows only its own domain: the example.com parent record no longer counts
  await admin.from("school").update({ allowed_email_domains: ["lakeview.edu.in"] } as never).eq("id", 12);
  await admin.from("person_membership").delete().eq("user_id", a.userId).eq("school_id", 12);
  const c = await resolveLogin(admin as never, email, "lakeview");
  const { data: m3 } = await admin.from("person_membership").select("school_id").eq("user_id", a.userId);
  check(c?.userId === a.userId && (m3 ?? []).every((m) => m.school_id === 8), "a college that allows only its own domain does not admit other emails");

  const membersNow = (await admin.from("person_membership").select("id", { count: "exact", head: true })).count;
  console.log("memberships before", membersBefore, "now (with test logins)", membersNow);
}
main().catch((e) => { failures++; console.log("FAIL", e?.message ?? e); }).finally(async () => {
  await admin.from("school").update({ allowed_email_domains: null } as never).eq("id", 12);
  for (const id of [...made.users, made.bystander].filter(Boolean) as string[]) { await admin.from("profile").delete().eq("id", id); await admin.auth.admin.deleteUser(id); }
  if (made.guardian) await admin.from("guardian").delete().eq("id", made.guardian);
  for (const id of [made.staff, made.bystanderStaff].filter(Boolean) as number[]) await admin.from("staff").delete().eq("id", id);
  const after = (await admin.from("person_membership").select("id", { count: "exact", head: true })).count;
  const { data: lv } = await admin.from("school").select("allowed_email_domains").eq("id", 12).single();
  console.log("restored: memberships", after, "lakeview domains", JSON.stringify(lv));
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
});
