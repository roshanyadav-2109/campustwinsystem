import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateBranding, setPlan, setUniversityStatus } from "@/app/console/actions";
import { ZoneHeader } from "@/components/console/table";
import { Section, StatusBadge, inputCls, labelCls, btnPrimary, btnGhost, btnDanger } from "@/components/console/ui";

export default async function UniversitySettingsZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  const admin = createAdminClient();
  const { data: u } = await admin.from("university").select("id, name, slug, status, plan, logo_url, primary_color").eq("id", uid).maybeSingle();
  if (!u) notFound();

  return (
    <div className="max-w-4xl">
      <ZoneHeader title="Settings">
        <StatusBadge status={u.status ?? "active"} />
        <form action={setUniversityStatus}>
          <input type="hidden" name="id" value={u.id} />
          <input type="hidden" name="status" value={u.status === "active" ? "suspended" : "active"} />
          <button className={u.status === "active" ? btnDanger : btnPrimary}>{u.status === "active" ? "Suspend university" : "Activate university"}</button>
        </form>
      </ZoneHeader>

      <div className="space-y-4">
        <Section title="Branding" desc="Shown on the university landing page">
          <form action={updateBranding} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={u.id} /><input type="hidden" name="kind" value="university" />
            <div><label className={labelCls}>Name</label><input name="name" defaultValue={u.name} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Primary colour</label>
              <div className="flex items-center gap-2">
                <span className="h-9 w-9 shrink-0 rounded-md border border-cx-line" style={{ background: u.primary_color ?? "#0F6CBD" }} />
                <input name="primary_color" defaultValue={u.primary_color ?? "#0F6CBD"} className={inputCls} />
              </div>
            </div>
            <div className="sm:col-span-2"><label className={labelCls}>Logo URL</label><input name="logo_url" defaultValue={u.logo_url ?? ""} className={inputCls} /></div>
            <div className="sm:col-span-2"><button className={btnPrimary}>Save branding</button></div>
          </form>
        </Section>

        <Section title="Plan" desc="Billing tier for every campus">
          <form action={setPlan} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={u.id} /><input type="hidden" name="kind" value="university" />
            <div className="min-w-[200px] flex-1"><label className={labelCls}>Plan name</label><input name="plan" defaultValue={u.plan ?? "standard"} className={inputCls} /></div>
            <button className={btnGhost}>Update plan</button>
          </form>
        </Section>
      </div>
    </div>
  );
}
