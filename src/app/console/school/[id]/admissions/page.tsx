import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip } from "@/components/console/table";
import { EmptyState, btnGhost } from "@/components/console/ui";
import { ModuleNotice } from "@/components/console/module-notice";
import { Icon } from "@/components/console/icons";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

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
      {(total ?? 0) > 0 ? (
        <div className={kpiStrip}>
          <Kpi label="Enquiries" value={total ?? 0} />
          <Kpi label="Still open" value={open ?? 0} />
          <Kpi label="Follow-ups logged" value={followups ?? 0} />
        </div>
      ) : (
        <EmptyState
          icon={<Icon name="admissions" size={22} />}
          title="No admission enquiries yet"
          body={`${s.name} hasn't logged any enquiries. Each enquiry the office records, and every follow-up on it, is counted here.`}
          action={on ? <a href={`https://${s.slug}.${BASE}/dashboard/admissions`} target="_blank" rel="noreferrer" className={btnGhost}>Open admissions in the school portal <Icon name="external" size={14} /></a> : undefined}
        />
      )}
    </div>
  );
}
