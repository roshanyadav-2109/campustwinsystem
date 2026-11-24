import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { InstitutionsTable, type InstRow } from "@/components/console/institutions-table";
import { Kpi } from "@/components/console/table";
import { btnPrimary } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

type SchoolRow = {
  id: number; name: string; slug: string; plan: string | null; status: string;
  university_id: number | null; students: { count: number }[]; staff: { count: number }[];
};
type Uni = { id: number; name: string; slug: string; plan: string | null; status: string };
const c = (a: { count: number }[] | null) => a?.[0]?.count ?? 0;

export default async function ConsolePage() {
  const admin = createAdminClient();
  const [{ data: unis }, { data: schools }] = await Promise.all([
    admin.from("university").select("id, name, slug, plan, status").order("name"),
    admin.from("school").select("id, name, slug, plan, status, university_id, students:student(count), staff:staff(count)").order("name"),
  ]);
  const allSchools = (schools ?? []) as unknown as SchoolRow[];
  const universities = (unis ?? []) as Uni[];
  const uniName = new Map(universities.map((u) => [u.id, u.name]));

  const campuses = allSchools.filter((s) => s.university_id);
  const standalone = allSchools.filter((s) => !s.university_id);
  const totalStudents = allSchools.reduce((n, s) => n + c(s.students), 0);
  const totalStaff = allSchools.reduce((n, s) => n + c(s.staff), 0);
  const suspended = universities.filter((u) => u.status !== "active").length + allSchools.filter((s) => s.status !== "active").length;

  const uniAgg = (uid: number) => campuses.filter((s) => s.university_id === uid).reduce(
    (acc, s) => ({ students: acc.students + c(s.students), staff: acc.staff + c(s.staff) }), { students: 0, staff: 0 },
  );

  const rows: InstRow[] = [
    ...universities.map<InstRow>((u) => {
      const agg = uniAgg(u.id);
      return { id: u.id, kind: "university", name: u.name, slug: `${u.slug}.${BASE}`, url: `${u.slug}.${BASE}`, parent: `${campuses.filter((s) => s.university_id === u.id).length} campuses`, plan: u.plan, status: u.status, students: agg.students, staff: agg.staff, href: `/console/university/${u.id}` };
    }),
    ...campuses.map<InstRow>((s) => ({ id: s.id, kind: "campus", name: s.name, slug: `${s.slug}.${BASE}`, url: `${s.slug}.${BASE}`, parent: uniName.get(s.university_id!) ?? null, plan: s.plan, status: s.status, students: c(s.students), staff: c(s.staff), href: `/console/school/${s.id}` })),
    ...standalone.map<InstRow>((s) => ({ id: s.id, kind: "school", name: s.name, slug: `${s.slug}.${BASE}`, url: `${s.slug}.${BASE}`, parent: null, plan: s.plan, status: s.status, students: c(s.students), staff: c(s.staff), href: `/console/school/${s.id}` })),
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink-900">Overview</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">Every institution on the CampusTwin platform.</p>
        </div>
        <Link href="/console/new" className={btnPrimary}>+ New institution</Link>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Universities" value={universities.length} />
        <Kpi label="Campuses" value={campuses.length} />
        <Kpi label="Standalone schools" value={standalone.length} />
        <Kpi label="Students" value={totalStudents} sub="all tenants" />
        <Kpi label="Staff" value={totalStaff} sub="all tenants" />
        <Kpi label="Suspended" value={suspended} />
      </div>

      <InstitutionsTable rows={rows} />
    </div>
  );
}
