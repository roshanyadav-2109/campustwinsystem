import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { InstitutionsTable, type InstRow } from "@/components/console/institutions-table";
import { btnPrimary } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

type SchoolRow = {
  id: number; name: string; slug: string; plan: string | null; status: string;
  university_id: number | null; students: { count: number }[]; staff: { count: number }[];
};
type Uni = { id: number; name: string; slug: string; plan: string | null; status: string };

const c = (a: { count: number }[] | null) => a?.[0]?.count ?? 0;

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-hair bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <p className="text-[12px] font-medium text-ink-500">{label}</p>
      <p className={`mt-1.5 text-[26px] font-semibold tracking-tight tabular-nums ${accent ? "text-amber-600" : "text-ink-900"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-ink-400">{sub}</p>}
    </div>
  );
}

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
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">Overview</h1>
          <p className="mt-1 text-[13px] text-ink-500">Every institution on the CampusTwin platform.</p>
        </div>
        <Link href="/console/new" className={btnPrimary}>+ New institution</Link>
      </div>

      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Universities" value={universities.length.toLocaleString()} />
        <Metric label="Campuses" value={campuses.length.toLocaleString()} />
        <Metric label="Standalone schools" value={standalone.length.toLocaleString()} />
        <Metric label="Students" value={totalStudents.toLocaleString()} sub="across all tenants" />
        <Metric label="Staff" value={totalStaff.toLocaleString()} sub="across all tenants" />
        <Metric label="Suspended" value={suspended.toLocaleString()} accent={suspended > 0} />
      </div>

      <InstitutionsTable rows={rows} />
    </div>
  );
}
