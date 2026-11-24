import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConsoleTable, Kpi, ZoneHeader, type Col, kpiStrip } from "@/components/console/table";
import { StatusBadge, TypeBadge } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const c = (a: { count: number }[] | null) => a?.[0]?.count ?? 0;
type Campus = { id: number; name: string; slug: string; status: string; students: { count: number }[]; staff: { count: number }[] };

export default async function UniversityOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  const admin = createAdminClient();
  const { data: u } = await admin.from("university").select("id, name, slug, status, plan").eq("id", uid).maybeSingle();
  if (!u) notFound();
  const [{ data: campuses }] = await Promise.all([
    admin.from("school").select("id, name, slug, status, students:student(count), staff:staff(count)").eq("university_id", uid).order("name"),
  ]);
  const camps = (campuses ?? []) as unknown as Campus[];
  const students = camps.reduce((n, x) => n + c(x.students), 0);
  const staff = camps.reduce((n, x) => n + c(x.staff), 0);

  const cols: Col<Campus>[] = [
    { key: "name", label: "Campus", render: (x) => <Link href={`/console/school/${x.id}`} className="font-medium text-cx-text hover:text-cx-link">{x.name}</Link> },
    { key: "sub", label: "Subdomain", render: (x) => <a href={`https://${x.slug}.${BASE}`} target="_blank" rel="noreferrer" className="text-cx-link hover:underline">{x.slug}.{BASE}</a> },
    { key: "students", label: "Students", align: "right", render: (x) => c(x.students).toLocaleString("en-IN") },
    { key: "staff", label: "Staff", align: "right", render: (x) => c(x.staff).toLocaleString("en-IN") },
    { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> },
    { key: "go", label: "", align: "right", render: (x) => <Link href={`/console/school/${x.id}`} className="rounded-md border border-cx-line px-2.5 py-1 text-[12px] font-medium text-cx-text-2 hover:bg-cx-raised">Manage</Link> },
  ];

  return (
    <div>
      <ZoneHeader title="Overview" sub={`${u.slug}.${BASE}`}>
        <TypeBadge kind="university" />
        <StatusBadge status={u.status ?? "active"} />
      </ZoneHeader>
      <div className={kpiStrip}>
        <Kpi label="Campuses" value={camps.length} href={`/console/university/${uid}/campuses`} />
        <Kpi label="Students" value={students} sub="all campuses" />
        <Kpi label="Staff" value={staff} sub="all campuses" />
      </div>
      <p className="mb-2 text-[14px] font-semibold text-cx-text">Campuses</p>
      <ConsoleTable columns={cols} rows={camps} rowKey={(x) => x.id} empty="No campuses yet" />
    </div>
  );
}
