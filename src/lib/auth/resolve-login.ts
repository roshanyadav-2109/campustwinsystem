import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

// Who an email is, across every institution on CampusTwin, and the one login
// they sign in with. Used by Google sign-in; kept separate so it can be tested
// directly.
//
// * Every staff, parent and student record holding the email becomes a
//   membership of the same login (one person, several institutions).
// * An institution that allows only certain email domains is skipped for
//   other addresses.
// * The login opens on the institution whose website they signed in from
//   (staff before parent before student there), else staff anywhere first.
// * Nothing is ever taken away from another institution: an existing login is
//   reused, never replaced.

type Admin = ReturnType<typeof createAdminClient>;
type Kind = "staff" | "guardian" | "student";
type Rec = { kind: Kind; id: number; name: string; schoolId: number; slug: string };
const ORDER: Record<Kind, number> = { staff: 1, guardian: 2, student: 3 };
const COL = { staff: "staff_id", guardian: "guardian_id", student: "student_id" } as const;

export async function findRecords(admin: Admin, email: string): Promise<Rec[]> {
  const exact = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const domain = email.split("@")[1] ?? "";
  const [{ data: staff }, { data: guardians }, { data: students }] = await Promise.all([
    admin.from("staff").select("id, full_name, school_id").ilike("email", exact).order("id"),
    admin.from("guardian").select("id, full_name, school_id").ilike("email", exact).order("id"),
    admin.from("student").select("id, full_name, school_id").ilike("email", exact).order("id"),
  ]);
  const raw: Omit<Rec, "slug">[] = [
    ...(staff ?? []).map((r) => ({ kind: "staff" as const, id: r.id, name: r.full_name, schoolId: r.school_id })),
    ...(guardians ?? []).map((r) => ({ kind: "guardian" as const, id: r.id, name: r.full_name, schoolId: r.school_id })),
    ...(students ?? []).map((r) => ({ kind: "student" as const, id: r.id, name: r.full_name, schoolId: r.school_id })),
  ];
  if (!raw.length) return [];
  const { data: schools } = await admin.from("school").select("id, slug, status, allowed_email_domains" as never).in("id", [...new Set(raw.map((r) => r.schoolId))]);
  const info = new Map(((schools ?? []) as unknown as { id: number; slug: string; status: string; allowed_email_domains: string[] | null }[]).map((s) => [s.id, s]));
  return raw
    .filter((r) => {
      const s = info.get(r.schoolId);
      if (!s) return false;
      const allowed = (s.allowed_email_domains ?? []).map((d) => d.toLowerCase().replace(/^@/, ""));
      return !allowed.length || allowed.includes(domain);
    })
    .map((r) => ({ ...r, slug: info.get(r.schoolId)!.slug }));
}

/** The login for this email, with a membership for every record. Null when no
 *  institution has a record for it. */
export async function resolveLogin(admin: Admin, email: string, hostSlug: string | null, googleName?: string): Promise<{ userId: string; primary: Rec } | null> {
  const records = await findRecords(admin, email);
  if (!records.length) return null;

  // Parents often have one parent record per child at the same school: keep
  // one per school, and link the other children to it.
  const byKey = new Map<string, Rec>();
  for (const r of records) {
    const key = `${r.schoolId}:${r.kind}`;
    if (!byKey.has(key)) byKey.set(key, r);
  }
  const chosen = [...byKey.values()];

  // The login: one already linked to any of these records, else one with this
  // email, else a new one.
  let userId: string | null = null;
  for (const r of chosen) {
    const { data } = await admin.from("person_membership" as never).select("user_id").eq(COL[r.kind], r.id).maybeSingle();
    const hit = data as { user_id: string } | null;
    if (hit) { userId = hit.user_id; break; }
    const { data: p } = await admin.from("profile").select("id").eq(COL[r.kind], r.id).maybeSingle();
    if (p) { userId = p.id; break; }
  }
  if (!userId) {
    const { data } = await admin.rpc("auth_user_for_email" as never, { p_email: email } as never);
    userId = (data as string | null) ?? null;
  }
  const name = chosen.find((r) => r.kind === "staff")?.name ?? chosen[0].name ?? googleName ?? email;
  if (!userId) {
    const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
    if (error || !created.user) return null;
    userId = created.user.id;
  } else {
    // The login carries this email (the office may have changed it on the record).
    const { data: got } = await admin.auth.admin.getUserById(userId);
    if (got.user && (got.user.email ?? "").toLowerCase() !== email) {
      const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
      if (error) return null;
    }
  }

  // Memberships for every institution's record.
  for (const r of chosen) {
    await admin.from("person_membership" as never).delete().eq(COL[r.kind], r.id).neq("user_id", userId);
    await admin.from("person_membership" as never).upsert({
      user_id: userId, school_id: r.schoolId, role: r.kind,
      staff_id: r.kind === "staff" ? r.id : null, guardian_id: r.kind === "guardian" ? r.id : null, student_id: r.kind === "student" ? r.id : null,
    } as never, { onConflict: "user_id,school_id,role" });
  }
  // Extra parent records at the same school: their children join the kept record.
  for (const r of chosen.filter((c) => c.kind === "guardian")) {
    const others = records.filter((o) => o.kind === "guardian" && o.schoolId === r.schoolId && o.id !== r.id).map((o) => o.id);
    if (!others.length) continue;
    const [{ data: theirs }, { data: mine }] = await Promise.all([
      admin.from("guardian_student").select("student_id").in("guardian_id", others),
      admin.from("guardian_student").select("student_id").eq("guardian_id", r.id),
    ]);
    const have = new Set((mine ?? []).map((l) => l.student_id));
    const missing = [...new Set((theirs ?? []).map((l) => l.student_id))].filter((s) => !have.has(s));
    if (missing.length) await admin.from("guardian_student").insert(missing.map((student_id) => ({ guardian_id: r.id, student_id, is_primary: false, school_id: r.schoolId })));
  }

  // Open on the institution they signed in from, else staff first anywhere.
  const sorted = [...chosen].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const primary = sorted.find((r) => r.slug === hostSlug) ?? sorted[0];
  const row = {
    id: userId, role: primary.kind, full_name: name, school_id: primary.schoolId,
    staff_id: primary.kind === "staff" ? primary.id : null,
    guardian_id: primary.kind === "guardian" ? primary.id : null,
    student_id: primary.kind === "student" ? primary.id : null,
  };
  // A record can be on one login only: take it off any older login first.
  await admin.from("profile").update({ [COL[primary.kind]]: null } as never).eq(COL[primary.kind], primary.id).neq("id", userId);
  const { error: pErr } = await admin.from("profile").upsert(row as never, { onConflict: "id" });
  if (pErr) return null;
  return { userId, primary };
}
