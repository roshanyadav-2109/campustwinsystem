import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { ConsoleTable, Pill, ZoneHeader, type Col } from "@/components/console/table";
import { ModuleNotice } from "@/components/console/module-notice";

type Bus = { id: number; code: string | null; registration_no: string | null };
type Route = { id: number; code: string | null; name: string | null; is_active: boolean };

export default async function TransportZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).transport;

  const [{ data: buses }, { data: routes }, { count: riders }] = await Promise.all([
    admin.from("bus").select("id, code, registration_no").eq("school_id", s.id).order("code"),
    admin.from("route").select("id, code, name, is_active").eq("school_id", s.id).order("code"),
    admin.from("student_transport").select("*", { count: "exact", head: true }).eq("school_id", s.id).eq("is_active", true),
  ]);

  const busCols: Col<Bus>[] = [
    { key: "code", label: "Bus", render: (b) => <span className="font-medium text-cx-text">{b.code ?? `#${b.id}`}</span> },
    { key: "reg", label: "Registration", render: (b) => <span className="font-mono text-[12px] text-cx-text-2">{b.registration_no ?? "—"}</span> },
  ];
  const routeCols: Col<Route>[] = [
    { key: "code", label: "Route", render: (r) => <span className="font-medium text-cx-text">{r.code ?? `#${r.id}`}</span> },
    { key: "name", label: "Name", render: (r) => <span className="text-cx-text-2">{r.name ?? "—"}</span> },
    { key: "active", label: "Status", render: (r) => <Pill tone={r.is_active ? "green" : "slate"}>{r.is_active ? "active" : "inactive"}</Pill> },
  ];

  return (
    <div>
      <ZoneHeader title="Transport" sub={`${(riders ?? 0).toLocaleString("en-IN")} students use school transport`} />
      {!on && <ModuleNotice module="transport" schoolId={s.id} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <div><p className="mb-2 text-[14px] font-semibold text-cx-text">Fleet</p><ConsoleTable columns={busCols} rows={(buses ?? []) as Bus[]} rowKey={(b) => b.id} empty="No buses" /></div>
        <div><p className="mb-2 text-[14px] font-semibold text-cx-text">Routes</p><ConsoleTable columns={routeCols} rows={(routes ?? []) as Route[]} rowKey={(r) => r.id} empty="No routes" /></div>
      </div>
    </div>
  );
}
