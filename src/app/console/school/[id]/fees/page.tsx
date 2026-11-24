import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip } from "@/components/console/table";
import { ModuleNotice } from "@/components/console/module-notice";

export default async function FeesZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).fees;
  const [{ count: invoices }, { count: heads }, { count: payments }] = await Promise.all([
    admin.from("fee_invoice").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("fee_head").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("fee_payment").select("*", { count: "exact", head: true }).eq("school_id", s.id),
  ]);

  return (
    <div>
      <ZoneHeader title="Fees" />
      {!on && <ModuleNotice module="fees" schoolId={s.id} />}
      <div className={kpiStrip}>
        <Kpi label="Fee heads" value={heads ?? 0} />
        <Kpi label="Invoices raised" value={invoices ?? 0} />
        <Kpi label="Payments" value={payments ?? 0} />
      </div>
      {(invoices ?? 0) === 0 && (
        <p className="rounded-lg border border-dashed border-cx-line px-4 py-10 text-center text-[13px] text-cx-muted">
          No fees have been billed yet. Fee heads, structures and invoices are managed by the school office inside the portal.
        </p>
      )}
    </div>
  );
}
