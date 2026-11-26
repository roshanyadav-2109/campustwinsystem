import { getSession, getCurrentYear } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { TransportSetup, type BusRow, type RouteRow, type RunRow, type StaffOpt } from "@/components/transport/transport-setup";

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default async function TransportSetupPage() {
  const denied = await guardTab("/dashboard/settings/transport");
  if (denied) return denied;
  await getSession();
  const year = await getCurrentYear();
  if (!year) return (<div><PageHeader title="Buses and Routes" /><EmptyState title="No school year is open yet" /></div>);
  const supabase = await createClient();
  const [{ data: buses }, { data: routes }, { data: stops }, { data: runs }, { data: staff }] = await Promise.all([
    supabase.from("bus").select("id, code, registration_no, capacity, is_active").order("code"),
    supabase.from("route").select("id, code, name, notes, is_active, annual_fee").order("code"),
    supabase.from("route_stop").select("id, route_id, seq, name, landmark, lat, lng, sched_am, sched_pm").order("seq"),
    supabase.from("bus_assignment").select("id, bus_id, route_id, driver_staff_id, conductor_staff_id, is_active").eq("academic_year_id", year.id).order("id"),
    supabase.from("staff").select("id, full_name, role").order("full_name"),
  ]);

  const busRows: BusRow[] = (buses ?? []).map((b) => ({ id: b.id, code: b.code, registrationNo: b.registration_no, capacity: b.capacity, active: b.is_active }));
  const routeRows: RouteRow[] = (routes ?? []).map((r) => ({
    id: r.id, code: r.code, name: r.name, notes: r.notes, active: r.is_active, annualFee: Number(r.annual_fee ?? 0),
    stops: (stops ?? []).filter((s) => s.route_id === r.id).map((s) => ({
      id: s.id, name: s.name, landmark: s.landmark ?? "", lat: s.lat, lng: s.lng, am: hhmm(s.sched_am), pm: hhmm(s.sched_pm),
    })),
  }));
  const runRows: RunRow[] = (runs ?? []).map((r) => ({ id: r.id, busId: r.bus_id, routeId: r.route_id, driverId: r.driver_staff_id, conductorId: r.conductor_staff_id, active: r.is_active }));
  const staffOpts: StaffOpt[] = (staff ?? []).map((s) => ({ id: s.id, name: s.full_name, role: s.role }));

  return (
    <div>
      <PageHeader title="Buses and Routes" description={`Buses, their routes and stops, and who runs each route in ${year.name}.`} />
      <TransportSetup buses={busRows} routes={routeRows} runs={runRows} staff={staffOpts} />
    </div>
  );
}
