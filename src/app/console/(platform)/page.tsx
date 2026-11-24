import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { attendanceRate30 } from "@/lib/console/tenant";
import { institutionRows } from "@/lib/console/institutions";
import { Kpi, ZoneHeader, kpiStrip, ConsoleTable, type Col } from "@/components/console/table";
import { Section, StatusBadge, TypeBadge, btnPrimary } from "@/components/console/ui";
import { MeterList } from "@/components/console/meter-list";
import type { InstRow } from "@/components/console/institutions-table";

export default async function ConsoleHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  if (q) redirect(`/console/institutions?q=${encodeURIComponent(q)}`);
  const admin = createAdminClient();
  const rows = await institutionRows();
  const tenants = rows.filter((r) => r.kind !== "university");
  const { data: years } = await admin.from("academic_year").select("id, school_id").eq("is_current", true);
  const yearOf = new Map((years ?? []).map((y) => [y.school_id, y.id]));
  const attendance = (await Promise.all(
    tenants.map(async (t) => {
      const y = yearOf.get(t.id);
      if (!y) return null;
      const rate = await attendanceRate30(t.id, y);
      return rate == null ? null : { label: t.name, value: rate };
    }),
  )).filter((x): x is { label: string; value: number } => x !== null).sort((a, b) => b.value - a.value);

  const students = tenants.reduce((n, t) => n + t.students, 0);
  const staff = tenants.reduce((n, t) => n + t.staff, 0);
  const suspended = rows.filter((r) => r.status !== "active").length;
  const top = [...tenants].sort((a, b) => b.students - a.students);

  const cols: Col<InstRow>[] = [
    { key: "name", label: "Name", render: (r) => <Link href={r.href} className="font-medium text-cx-link hover:underline">{r.name}</Link> },
    { key: "type", label: "Type", render: (r) => <TypeBadge kind={r.kind} /> },
    { key: "students", label: "Students", align: "right", render: (r) => <span className="text-cx-text">{r.students.toLocaleString("en-IN")}</span> },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <ZoneHeader title="Dashboard">
        <Link href="/console/new" className={btnPrimary}>New institution</Link>
      </ZoneHeader>

      <div className={kpiStrip}>
        <Kpi label="Institutions" value={rows.length} href="/console/institutions" />
        <Kpi label="Students" value={students} />
        <Kpi label="Staff" value={staff} />
        {suspended > 0 && <Kpi label="Suspended" value={suspended} />}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title="Largest institutions" flush right={<Link href="/console/institutions" className="text-[13px] text-cx-link hover:underline">View all</Link>}>
            <ConsoleTable bare columns={cols} rows={top.slice(0, 8)} rowKey={(r) => `${r.kind}-${r.id}`} empty="No institutions yet" />
          </Section>
        </div>
        <Section title="Attendance rate" desc="Present or late, last 30 days" flush>
          <MeterList rows={attendance} max={100} format={(v) => `${v.toFixed(1)}%`} labelWidth={150} />
        </Section>
      </div>
    </div>
  );
}
