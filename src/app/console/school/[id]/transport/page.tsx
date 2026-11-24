import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { ConsoleTable, Pill, Kpi, ZoneHeader, kpiStrip, type Col } from "@/components/console/table";
import { Section, EmptyState } from "@/components/console/ui";
import { ModuleNotice } from "@/components/console/module-notice";
import { Icon } from "@/components/console/icons";

type Route = { id: number; code: string | null; name: string | null; is_active: boolean; riders: number };
type Bus = { id: number; code: string | null; registration_no: string | null; route: string | null; driver: string | null };
// Route names are stored as "A — B"; read them as a journey.
const journey = (n: string | null) => (n ?? "").replace(/\s+[—–-]\s+/g, " to ");

export default async function TransportZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).transport;

  const [{ data: buses }, { data: routes }, { data: rides }, { data: assignments }] = await Promise.all([
    admin.from("bus").select("id, code, registration_no").eq("school_id", s.id).order("code"),
    admin.from("route").select("id, code, name, is_active").eq("school_id", s.id).order("code"),
    admin.from("student_transport").select("route_id").eq("school_id", s.id).eq("is_active", true).limit(5000),
    admin.from("bus_assignment").select("bus_id, route:route_id(code), driver:driver_staff_id(full_name)").eq("school_id", s.id),
  ]);

  const perRoute = new Map<number, number>();
  for (const r of rides ?? []) perRoute.set(r.route_id, (perRoute.get(r.route_id) ?? 0) + 1);
  const riders = (rides ?? []).length;
  const routeRows: Route[] = (routes ?? []).map((r) => ({ ...r, riders: perRoute.get(r.id) ?? 0 }));
  const maxRiders = Math.max(1, ...routeRows.map((r) => r.riders));

  const asg = new Map<number, { route: string | null; driver: string | null }>();
  for (const a of (assignments ?? []) as unknown as { bus_id: number; route: { code: string } | null; driver: { full_name: string } | null }[]) {
    asg.set(a.bus_id, { route: a.route?.code ?? null, driver: a.driver?.full_name ?? null });
  }
  const busRows: Bus[] = (buses ?? []).map((b) => ({ ...b, route: asg.get(b.id)?.route ?? null, driver: asg.get(b.id)?.driver ?? null }));

  if (routeRows.length === 0 && busRows.length === 0) {
    return (
      <div>
        <ZoneHeader title="Transport" />
        {!on && <ModuleNotice module="transport" schoolId={s.id} />}
        <EmptyState icon={<Icon name="transport" size={22} />} title="No routes or buses yet" body={`${s.name} hasn't set up school transport. Routes, buses and the students on each route show here once the office adds them.`} />
      </div>
    );
  }

  const routeCols: Col<Route>[] = [
    { key: "code", label: "Route", width: "72px", render: (r) => <span className="font-semibold text-cx-text">{r.code ?? r.id}</span> },
    { key: "name", label: "Journey", render: (r) => <span className="text-cx-text">{journey(r.name)}</span> },
    { key: "riders", label: "Students", width: "220px", render: (r) => (
      <span className="flex items-center gap-3">
        <span className="relative h-2 flex-1 rounded-full bg-cx-raised"><span className="absolute inset-y-0 left-0 rounded-full bg-[#0b57d0]" style={{ width: `${(r.riders / maxRiders) * 100}%` }} /></span>
        <span className="w-10 text-right tabular-nums text-cx-text">{r.riders}</span>
      </span>
    ) },
    { key: "status", label: "Status", width: "96px", render: (r) => <Pill tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Running" : "Paused"}</Pill> },
  ];
  const busCols: Col<Bus>[] = [
    { key: "code", label: "Bus", render: (b) => <span className="font-semibold text-cx-text">{b.code ?? b.id}</span> },
    { key: "reg", label: "Registration", render: (b) => <span className="font-mono text-[12.5px]">{b.registration_no ?? "Not recorded"}</span> },
    { key: "route", label: "Route", render: (b) => b.route ?? <span className="text-cx-muted">Unassigned</span> },
    { key: "driver", label: "Driver", render: (b) => b.driver ?? <span className="text-cx-muted">Unassigned</span> },
  ];

  return (
    <div>
      <ZoneHeader title="Transport" />
      {!on && <ModuleNotice module="transport" schoolId={s.id} />}

      <div className={kpiStrip}>
        <Kpi label="Students on transport" value={riders} />
        <Kpi label="Routes" value={routeRows.length} />
        <Kpi label="Buses" value={busRows.length} />
        <Kpi label="Average per route" value={routeRows.length ? Math.round(riders / routeRows.length) : 0} />
      </div>

      <div className="space-y-4">
        <Section title="Routes" desc="Students assigned to each route" flush>
          <ConsoleTable bare columns={routeCols} rows={routeRows} rowKey={(r) => r.id} empty="No routes" />
        </Section>
        <Section title="Fleet" desc="Each bus with its route and driver" flush>
          <ConsoleTable bare columns={busCols} rows={busRows} rowKey={(b) => b.id} empty="No buses" />
        </Section>
      </div>
    </div>
  );
}
