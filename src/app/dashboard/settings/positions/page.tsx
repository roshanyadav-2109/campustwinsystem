import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { managesPeople } from "@/lib/roles";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { PositionsAdmin, type TitleRow, type UnitRow, type PositionRow } from "@/components/settings/positions";
import { OrgChart, type Chart } from "@/components/settings/org-chart";

// Settings → Roles and positions (colleges and universities).
export default async function PositionsPage() {
  const denied = await guardTab("/dashboard/settings/positions");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const [t, u, d, g, s, p, l, oc] = await Promise.all([
    supabase.from("position_title" as never).select("id, name, access_type, scope_level, active, sort").order("sort").order("name"),
    supabase.from("academic_unit" as never).select("id, code, name, kind, parent_id").order("name"),
    supabase.from("department" as never).select("id, code, name, unit_id").order("name"),
    supabase.from("programme" as never).select("id, code, name").order("name"),
    supabase.from("staff").select("id, full_name").order("full_name"),
    supabase.from("staff_position" as never).select("id, staff_id, title_id, unit_id, department_id, programme_id, starts_on, ends_on, acting").order("starts_on", { ascending: false }).limit(1000),
    supabase.from("position_log" as never).select("at, action, detail, staff:staff_id(full_name), by:by_staff(full_name)").order("at", { ascending: false }).limit(30),
    supabase.rpc("org_chart" as never),
  ]);
  const chart = (oc.data ?? { units: [], departments: [], programmes: [], positions: [] }) as unknown as Chart;
  return (
    <div className="space-y-4">
      <PageHeader title="Roles and positions" description="Name your own titles (Vice Chancellor, Dean, Director, Head of Department...), say what kind of role each is and where it applies, and who holds which. One person can hold several positions." />
      <OrgChart chart={chart} staff={(s.data ?? []).map((x) => ({ id: x.id, name: x.full_name }))} canEdit={managesPeople(session)} />
      <PositionsAdmin
        titles={(t.data ?? []) as unknown as TitleRow[]}
        units={(u.data ?? []) as unknown as UnitRow[]}
        departments={(d.data ?? []) as unknown as { id: number; code: string; name: string; unit_id: number | null }[]}
        programmes={(g.data ?? []) as unknown as { id: number; code: string; name: string }[]}
        staff={(s.data ?? []).map((x) => ({ id: x.id, name: x.full_name }))}
        positions={(p.data ?? []) as unknown as PositionRow[]}
        log={(l.data ?? []) as unknown as { at: string; action: string; detail: string; staff: { full_name: string } | null; by: { full_name: string } | null }[]}
        canEdit={managesPeople(session)} />
    </div>
  );
}
