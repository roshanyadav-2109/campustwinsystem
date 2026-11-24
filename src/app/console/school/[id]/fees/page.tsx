import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip } from "@/components/console/table";
import { EmptyState, btnGhost } from "@/components/console/ui";
import { ModuleNotice } from "@/components/console/module-notice";
import { Icon } from "@/components/console/icons";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

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
      {(invoices ?? 0) > 0 ? (
        <div className={kpiStrip}>
          <Kpi label="Fee heads" value={heads ?? 0} />
          <Kpi label="Invoices raised" value={invoices ?? 0} />
          <Kpi label="Payments recorded" value={payments ?? 0} />
        </div>
      ) : (
        <EmptyState
          icon={<Icon name="fees" size={22} />}
          title="No fees billed yet"
          body={`${s.name} hasn't raised any invoices. The school office sets up fee heads and bills students from its own portal, and the totals appear here as soon as it does.`}
          action={on ? <a href={`https://${s.slug}.${BASE}/dashboard/fees`} target="_blank" rel="noreferrer" className={btnGhost}>Open fees in the school portal <Icon name="external" size={14} /></a> : undefined}
        />
      )}
    </div>
  );
}
