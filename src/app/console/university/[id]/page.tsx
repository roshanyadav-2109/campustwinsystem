import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConsoleTable, Kpi, ZoneHeader, type Col } from "@/components/console/table";
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
  const [{ data: campuses }, { count: admins }] = await Promise.all([
    admin.from("school").select("id, name, slug, status, students:student(count), staff:staff(count)").eq("university_id", uid).order("name"),
    admin.from("profile").select("*", { count: "exact", head: true }).eq("university_id", uid),
  ]);
  const camps = (campuses ?? []) as unknown as Campus[];
  const students = camps.reduce((n, x) => n + c(x.students), 0);
  const staff = camps.reduce((n, x) => n + c(x.staff), 0);

  const cols: Col<Campus>[] = [
    { key: "name", label: "Campus", render: (x) => <Link href={`/console/school/${x.id}`} className="font-medium text-ink-900 hover:text-[#0F6CBD]">{x.name}</Link> },
    { key: "sub", label: "Subdomain", render: (x) => <a href={`https://${x.slug}.${BASE}`} target="_blank" rel="noreferrer" className="text-[#0F6CBD] hover:underline">{x.slug}.{BASE}</a> },
    { key: "students", label: "Students", align: "right", render: (x) => c(x.students).toLocaleString() },
    { key: "staff", label: "Staff", align: "right", render: (x) => c(x.staff).toLocaleString() },
    { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> },
    { key: "go", label: "", align: "right", render: (x) => <Link href={`/console/school/${x.id}`} className="rounded-md border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-600 hover:bg-panel">Manage</Link> },
  ];

  return (
    <div>
      <ZoneHeader title="Overview" sub={`${u.slug}.${BASE}`}>
        <TypeBadge kind="university" />
        <StatusBadge status={u.status ?? "active"} />
      </ZoneHeader>
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi label="Campuses" value={camps.length} href={`/console/university/${uid}/campuses`} />
        <Kpi label="Students" value={students} sub="all campuses" />
        <Kpi label="Staff" value={staff} sub="all campuses" />
        <Kpi label="Central admins" value={admins ?? 0} href={`/console/university/${uid}/admins`} />
      </div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-400">Campuses</p>
      <ConsoleTable columns={cols} rows={camps} rowKey={(x) => x.id} empty="No campuses yet." />
    </div>
  );
}
