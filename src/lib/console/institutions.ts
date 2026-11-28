import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InstRow } from "@/components/console/institutions-table";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
type SchoolRow = { id: number; name: string; slug: string; plan: string | null; status: string; university_id: number | null; institution_type: string | null; students: { count: number }[]; staff: { count: number }[] };
type Uni = { id: number; name: string; slug: string; plan: string | null; status: string };
const c = (a: { count: number }[] | null) => a?.[0]?.count ?? 0;

export async function institutionRows(): Promise<InstRow[]> {
  const admin = createAdminClient();
  const [{ data: unis }, { data: schools }] = await Promise.all([
    admin.from("university").select("id, name, slug, plan, status").order("name"),
    admin.from("school").select("id, name, slug, plan, status, university_id, institution_type, students:student(count), staff:staff(count)").order("name"),
  ]);
  const all = (schools ?? []) as unknown as SchoolRow[];
  const universities = (unis ?? []) as Uni[];
  const uniName = new Map(universities.map((u) => [u.id, u.name]));
  const campuses = all.filter((s) => s.university_id);
  return [
    ...universities.map<InstRow>((u) => {
      const mine = campuses.filter((s) => s.university_id === u.id);
      return { id: u.id, kind: "university", name: u.name, slug: `${u.slug}.${BASE}`, url: `${u.slug}.${BASE}`, parent: `${mine.length} campus${mine.length === 1 ? "" : "es"}`, plan: u.plan, status: u.status ?? "active", students: mine.reduce((n, s) => n + c(s.students), 0), staff: mine.reduce((n, s) => n + c(s.staff), 0), href: `/console/university/${u.id}` };
    }),
    ...all.map<InstRow>((s) => ({ id: s.id, kind: s.university_id ? "campus" : s.institution_type === "college" ? "college" : "school", name: s.name, slug: `${s.slug}.${BASE}`, url: `${s.slug}.${BASE}`, parent: s.university_id ? uniName.get(s.university_id) ?? null : null, plan: s.plan, status: s.status, students: c(s.students), staff: c(s.staff), href: `/console/school/${s.id}` })),
  ];
}

