import "server-only";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export type Admin = ReturnType<typeof createAdminClient>;

export async function loadSchool(id: string | number) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("school")
    .select("id, name, slug, place, status, plan, modules, university_id, logo_url, primary_color")
    .eq("id", Number(id))
    .maybeSingle();
  if (!data) notFound();
  return data;
}

export async function currentYear(admin: Admin, schoolId: number) {
  const { data } = await admin
    .from("academic_year")
    .select("id, name, is_current, start_date, end_date")
    .eq("school_id", schoolId)
    .order("is_current", { ascending: false })
    .order("start_date", { ascending: false });
  return (data ?? [])[0] ?? null;
}

// Class + section lookup maps for a tenant, with the canonical "IX-C" label.
export async function sectionClassMaps(admin: Admin, schoolId: number) {
  const [{ data: classes }, { data: sections }] = await Promise.all([
    admin.from("class").select("id, name, level, stage").eq("school_id", schoolId).order("level"),
    admin.from("section").select("id, name, class_id").eq("school_id", schoolId).order("name"),
  ]);
  const classById = new Map((classes ?? []).map((c) => [c.id, c]));
  const sectionLabel = new Map((sections ?? []).map((s) => [s.id, `${classById.get(s.class_id)?.name ?? "?"}-${s.name}`]));
  return { classes: classes ?? [], sections: sections ?? [], classById, sectionLabel };
}

export async function headCount(admin: Admin, table: string, schoolId: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (admin.from(table as any) as any).select("*", { count: "exact", head: true }).eq("school_id", schoolId);
  return (count as number | null) ?? 0;
}

export const modulesOf = (m: unknown): Record<string, boolean> => (m as Record<string, boolean> | null) ?? {};

// ---------------------------------------------------------------- analytics
// Cached per school for 10 minutes: these scan the attendance table, so a busy
// console must not re-run them on every page view.

type Range = { present: number; total: number };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

async function rangeByClass(admin: Admin, yearId: number, start: string, end: string) {
  const { data } = await admin.rpc("attendance_overview_range", { p_start: start, p_end: end, p_year: yearId });
  return (data ?? []) as { class_id: number; class_name: string; class_level: number; present: number; total: number }[];
}

export type AttendanceAnalytics = {
  latest: string | null;
  weekly: { start: string; end: string; rate: number }[];
  byClass: { name: string; level: number; rate: number }[];
  rate30: number | null;
};

export const attendanceAnalytics = (schoolId: number, yearId: number) =>
  unstable_cache(async (): Promise<AttendanceAnalytics> => {
    const admin = createAdminClient();
    const { data: last } = await admin.from("attendance_record").select("on_date").eq("school_id", schoolId).eq("academic_year_id", yearId).is("period", null).order("on_date", { ascending: false }).limit(1);
    const latest = (last?.[0]?.on_date as string | undefined) ?? null;
    if (!latest) return { latest: null, weekly: [], byClass: [], rate30: null };

    const weeks = Array.from({ length: 12 }, (_, i) => { const end = addDays(latest, -7 * i); return { start: addDays(end, -6), end }; }).reverse();
    const [weekRows, month] = await Promise.all([
      Promise.all(weeks.map((w) => rangeByClass(admin, yearId, w.start, w.end))),
      rangeByClass(admin, yearId, addDays(latest, -29), latest),
    ]);
    const sum = (rows: Range[]) => rows.reduce((a, r) => ({ present: a.present + Number(r.present), total: a.total + Number(r.total) }), { present: 0, total: 0 });
    const pct = (r: Range) => Math.round((1000 * r.present) / r.total) / 10;

    const weekly = weeks.map((w, i) => ({ ...w, t: sum(weekRows[i]) })).filter((w) => w.t.total > 0).map((w) => ({ start: w.start, end: w.end, rate: pct(w.t) }));
    const cls = new Map<string, { level: number } & Range>();
    for (const r of month) {
      const c = cls.get(r.class_name) ?? { level: r.class_level, present: 0, total: 0 };
      c.present += Number(r.present); c.total += Number(r.total); cls.set(r.class_name, c);
    }
    const byClass = [...cls.entries()].filter(([, v]) => v.total > 0).map(([name, v]) => ({ name, level: v.level, rate: pct(v) })).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    const m = sum(month);
    return { latest, weekly, byClass, rate30: m.total ? pct(m) : null };
  }, ["console-attendance", String(schoolId), String(yearId)], { revalidate: 600 })();

export const enrollmentByClass = (schoolId: number, yearId: number) =>
  unstable_cache(async () => {
    const admin = createAdminClient();
    const { classes, sections } = await sectionClassMaps(admin, schoolId);
    const bySection = new Map<number, number>();
    for (let from = 0; ; from += 1000) {
      const { data } = await admin.from("student_enrollment").select("section_id").eq("school_id", schoolId).eq("academic_year_id", yearId).neq("status", "transferred").range(from, from + 999);
      for (const e of data ?? []) bySection.set(e.section_id, (bySection.get(e.section_id) ?? 0) + 1);
      if (!data || data.length < 1000) break;
    }
    return classes.map((c) => ({
      name: c.name,
      students: sections.filter((s) => s.class_id === c.id).reduce((n, s) => n + (bySection.get(s.id) ?? 0), 0),
    }));
  }, ["console-enrollment", String(schoolId), String(yearId)], { revalidate: 600 })();

async function pageAll<T>(fetchPage: (from: number) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await fetchPage(from);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const tally = (vals: (string | null)[]) => {
  const m = new Map<string, number>();
  for (const v of vals) m.set(v ?? "unknown", (m.get(v ?? "unknown") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
};

export const studentBreakdown = (schoolId: number) =>
  unstable_cache(async () => {
    const admin = createAdminClient();
    const rows = await pageAll<{ status: string; gender: string | null }>((from) =>
      admin.from("student").select("status, gender").eq("school_id", schoolId).range(from, from + 999));
    return { status: tally(rows.map((r) => r.status)), gender: tally(rows.filter((r) => r.status === "active").map((r) => r.gender)) };
  }, ["console-student-breakdown", String(schoolId)], { revalidate: 600 })();

export const staffRoles = (schoolId: number) =>
  unstable_cache(async () => {
    const admin = createAdminClient();
    const rows = await pageAll<{ role: string }>((from) => admin.from("staff").select("role").eq("school_id", schoolId).range(from, from + 999));
    return tally(rows.map((r) => r.role));
  }, ["console-staff-roles", String(schoolId)], { revalidate: 600 })();

export const humanize = (s: string) => (s === "unknown" ? "Not recorded" : s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));

export const assessmentStats = (schoolId: number, yearId: number) =>
  unstable_cache(async () => {
    const admin = createAdminClient();
    const rows = await pageAll<{ subject_id: number; section_id: number; assessed_on: string }>((from) =>
      admin.from("assessment").select("subject_id, section_id, assessed_on").eq("school_id", schoolId).eq("academic_year_id", yearId).range(from, from + 999));
    const { data: subjects } = await admin.from("subject").select("id, name").eq("school_id", schoolId);
    const subjectName = new Map((subjects ?? []).map((x) => [x.id, x.name]));
    const bySubject = tally(rows.map((r) => subjectName.get(r.subject_id) ?? "Other"));
    const months = new Map<string, number>();
    for (const r of rows) { const k = r.assessed_on.slice(0, 7); months.set(k, (months.get(k) ?? 0) + 1); }
    const byMonth = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => ({
      key: k,
      label: new Date(k + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }),
      value,
    }));
    const latest = rows.reduce<string | null>((m, r) => (!m || r.assessed_on > m ? r.assessed_on : m), null);
    return { total: rows.length, subjects: bySubject.length, sections: new Set(rows.map((r) => r.section_id)).size, latest, bySubject, byMonth };
  }, ["console-assessments", String(schoolId), String(yearId)], { revalidate: 600 })();

export const guardianRelations = (schoolId: number) =>
  unstable_cache(async () => {
    const admin = createAdminClient();
    const rows = await pageAll<{ relation: string | null }>((from) => admin.from("guardian").select("relation").eq("school_id", schoolId).range(from, from + 999));
    return tally(rows.map((r) => (r.relation ? r.relation.toLowerCase() : null)));
  }, ["console-guardian-relations", String(schoolId)], { revalidate: 600 })();

// One 30-day figure per institution, for cross-tenant views: two calls each,
// not the twelve-week trend, so a dashboard of many tenants stays cheap.
export const attendanceRate30 = (schoolId: number, yearId: number) =>
  unstable_cache(async (): Promise<number | null> => {
    const admin = createAdminClient();
    const { data: last } = await admin.from("attendance_record").select("on_date").eq("school_id", schoolId).eq("academic_year_id", yearId).is("period", null).order("on_date", { ascending: false }).limit(1);
    const latest = last?.[0]?.on_date as string | undefined;
    if (!latest) return null;
    const rows = await rangeByClass(admin, yearId, addDays(latest, -29), latest);
    const t = rows.reduce((a, r) => ({ present: a.present + Number(r.present), total: a.total + Number(r.total) }), { present: 0, total: 0 });
    return t.total ? Math.round((1000 * t.present) / t.total) / 10 : null;
  }, ["console-att30", String(schoolId), String(yearId)], { revalidate: 600 })();
