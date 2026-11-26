import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { attendanceRate30 } from "@/lib/console/tenant";
import { institutionRows } from "@/lib/console/institutions";
import { Kpi, ZoneHeader, kpiStrip, ConsoleTable, type Col } from "@/components/console/table";
import { Section, StatusBadge, TypeBadge, btnPrimary } from "@/components/console/ui";
import { MeterList } from "@/components/console/meter-list";
import { decidePlanRequest } from "@/app/console/actions";
import { btnGhost } from "@/components/console/ui";
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
  const { data: reqData } = await admin.from("plan_request" as never).select("id, school_id, requested_plan, note, created_at").eq("status", "pending").order("created_at");
  const requests = (reqData ?? []) as { id: number; school_id: number; requested_plan: string; note: string | null; created_at: string }[];
  const { data: planNames } = await admin.schema("core" as never).from("plan" as never).select("code, name").eq("product_code", "campustwin");
  const planName = new Map(((planNames ?? []) as { code: string; name: string }[]).map((p) => [p.code, p.name]));
  const schoolName = new Map(rows.filter((r) => r.kind !== "university").map((r) => [r.id, r.name]));

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

      {requests.length > 0 && (
        <div className="mb-4">
          <Section title={`Plan change requests (${requests.length})`} desc="Asked for by schools from their School admin page">
            <ul className="divide-y divide-cx-line">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] text-cx-text"><span className="font-medium">{schoolName.get(r.school_id) ?? `School ${r.school_id}`}</span> asks to move to <span className="font-medium">{planName.get(r.requested_plan) ?? r.requested_plan}</span></p>
                    {r.note && <p className="text-[12.5px] text-cx-muted">{r.note}</p>}
                  </div>
                  <form action={decidePlanRequest}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><button className={btnPrimary}>Approve</button></form>
                  <form action={decidePlanRequest}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="decline" /><button className={btnGhost}>Decline</button></form>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

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
