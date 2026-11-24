import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { updateBranding, setPlan, toggleModule, setSchoolStatus } from "@/app/console/actions";
import { ZoneHeader } from "@/components/console/table";
import { Section, StatusBadge, inputCls, labelCls, btnPrimary, btnGhost, btnDanger } from "@/components/console/ui";

const MODULES: { key: string; label: string; desc: string }[] = [
  { key: "fees", label: "Fees", desc: "Fee heads, invoices and collection" },
  { key: "library", label: "Library", desc: "Catalogue, issue and returns" },
  { key: "homework", label: "Homework", desc: "Assignments and submissions" },
  { key: "admissions", label: "Admissions", desc: "Enquiries and the admission pipeline" },
  { key: "hr", label: "HR", desc: "Staff records, leave and payroll" },
  { key: "transport", label: "Transport", desc: "Routes, vehicles and tracking" },
];

export default async function SettingsZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const mods = modulesOf(s.modules);

  return (
    <div className="max-w-4xl">
      <ZoneHeader title="Settings">
        <StatusBadge status={s.status} />
        <form action={setSchoolStatus}>
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="status" value={s.status === "active" ? "suspended" : "active"} />
          <button className={s.status === "active" ? btnDanger : btnPrimary}>{s.status === "active" ? "Suspend institution" : "Activate institution"}</button>
        </form>
      </ZoneHeader>

      <div className="space-y-5">
        <Section title="Branding" desc="Shown on this institution's login and dashboard.">
          <form action={updateBranding} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value="school" />
            <div><label className={labelCls}>Name</label><input name="name" defaultValue={s.name} className={inputCls} /></div>
            <div><label className={labelCls}>Place</label><input name="place" defaultValue={s.place ?? ""} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Primary colour</label>
              <div className="flex items-center gap-2">
                <span className="h-9 w-9 shrink-0 rounded-md border border-hair" style={{ background: s.primary_color ?? "#0F6CBD" }} />
                <input name="primary_color" defaultValue={s.primary_color ?? "#0F6CBD"} className={inputCls} />
              </div>
            </div>
            <div><label className={labelCls}>Logo URL</label><input name="logo_url" defaultValue={s.logo_url ?? ""} className={inputCls} /></div>
            <div className="sm:col-span-2"><button className={btnPrimary}>Save branding</button></div>
          </form>
        </Section>

        <Section title="Modules" desc="Turn paid features on or off for this institution.">
          <div className="grid gap-2 sm:grid-cols-2">
            {MODULES.map((m) => {
              const on = !!mods[m.key];
              return (
                <form key={m.key} action={toggleModule} className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 ${on ? "border-[#0F6CBD]/30 bg-[#0F6CBD]/[0.03]" : "border-hair bg-white"}`}>
                  <input type="hidden" name="id" value={s.id} /><input type="hidden" name="key" value={m.key} />
                  <div className="min-w-0"><p className="text-[13px] font-medium text-ink-900">{m.label}</p><p className="truncate text-[11.5px] text-ink-500">{m.desc}</p></div>
                  <button aria-label={`${on ? "Disable" : "Enable"} ${m.label}`} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[#0F6CBD]" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </form>
              );
            })}
          </div>
        </Section>

        <Section title="Plan" desc="Billing tier for this institution.">
          <form action={setPlan} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value="school" />
            <div className="min-w-[200px] flex-1"><label className={labelCls}>Plan name</label><input name="plan" defaultValue={s.plan ?? "standard"} className={inputCls} /></div>
            <button className={btnGhost}>Update plan</button>
          </form>
        </Section>
      </div>
    </div>
  );
}
