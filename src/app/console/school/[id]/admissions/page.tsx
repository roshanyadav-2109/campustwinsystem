import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip } from "@/components/console/table";
import { ModuleNotice } from "@/components/console/module-notice";

export default async function AdmissionsZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).admissions;
  const [{ count: total }, { count: open }, { count: followups }] = await Promise.all([
    admin.from("admission_enquiry").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("admission_enquiry").select("*", { count: "exact", head: true }).eq("school_id", s.id).eq("status", "open"),
    admin.from("admission_followup").select("*", { count: "exact", head: true }).eq("school_id", s.id),
  ]);

  return (
    <div>
      <ZoneHeader title="Admissions" />
      {!on && <ModuleNotice module="admissions" schoolId={s.id} />}
      {(total ?? 0) > 0 && (<div className={kpiStrip}>
        <Kpi label="Enquiries" value={total ?? 0} />
        <Kpi label="Open" value={open ?? 0} />
        <Kpi label="Follow-ups" value={followups ?? 0} />
      </div>)}
      {(total ?? 0) === 0 && (
        <p className="rounded-lg border border-dashed border-cx-line px-4 py-10 text-center text-[13px] text-cx-muted">
          No admission enquiries yet. The pipeline is managed by the school office inside the portal.
        </p>
      )}
    </div>
  );
}
