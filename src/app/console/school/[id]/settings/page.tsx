import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { updateBranding, setPlan, toggleModule, resetModules, setSchoolStatus } from "@/app/console/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZoneHeader } from "@/components/console/table";
import { Section, StatusBadge, inputCls, labelCls, btnPrimary, btnGhost, btnDanger } from "@/components/console/ui";

const MODULES: { key: string; label: string; desc: string }[] = [
  { key: "fees", label: "Fees", desc: "Fee heads, invoices and collection" },
  { key: "library", label: "Library", desc: "Catalogue, issues and returns" },
  { key: "homework", label: "Homework", desc: "Assignments and submissions" },
  { key: "admissions", label: "Admissions", desc: "Enquiries and follow-ups" },
  { key: "hr", label: "HR and payroll", desc: "Staff leave, salaries and payslips" },
  { key: "transport", label: "Transport", desc: "Routes, buses and live tracking" },
];
const hint = "mt-1 text-[12px] text-cx-muted";

export default async function SettingsZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const mods = modulesOf(s.modules);
  const active = s.status === "active";
  const admin = createAdminClient();
  const { data: planRows } = await admin.schema("core" as never).from("plan" as never).select("code, name, active, features").eq("product_code", "campustwin").order("price_paise");
  const plans = (planRows ?? []) as { code: string; name: string; active: boolean; features: { modules?: Record<string, boolean> } | null }[];
  const planMods = plans.find((p) => p.code === s.plan)?.features?.modules ?? {};
  const overrides = modulesOf((s as { module_overrides?: unknown }).module_overrides);
  const campus = !!(s as { university_id?: number | null }).university_id;

  return (
    <div>
      <ZoneHeader title="Settings" badges={<StatusBadge status={s.status} />} />

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Section title="Branding" desc="What students, parents and staff see on sign-in and in the portal">
            <form action={updateBranding} className="space-y-4">
              <input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value="school" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className={labelCls} htmlFor="b-name">Name</label><input id="b-name" name="name" defaultValue={s.name} className={inputCls} /></div>
                <div><label className={labelCls} htmlFor="b-place">Town or city</label><input id="b-place" name="place" defaultValue={s.place ?? ""} className={inputCls} /></div>
                {!campus && (
                  <div><label className={labelCls} htmlFor="b-type">Type of institution</label>
                    <select id="b-type" name="institution_type" defaultValue={s.institution_type ?? "school"} className={inputCls}>
                      <option value="school">School</option>
                      <option value="college">College</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className={labelCls} htmlFor="b-color">Brand colour</label>
                  <div className="flex items-center gap-2">
                    <span className="h-8 w-8 shrink-0 rounded-md border border-cx-line" style={{ background: s.primary_color ?? "#0F6CBD" }} />
                    <input id="b-color" name="primary_color" defaultValue={s.primary_color ?? "#0F6CBD"} className={inputCls} />
                  </div>
                  <p className={hint}>A hex value, used for the sign-in accent</p>
                </div>
                <div>
                  <label className={labelCls} htmlFor="b-logo">Logo address</label>
                  <input id="b-logo" name="logo_url" defaultValue={s.logo_url ?? ""} className={inputCls} placeholder="https://" />
                  <p className={hint}>Square image, at least 256 pixels</p>
                </div>
              </div>
              <div className="flex justify-end border-t border-cx-line pt-4"><button className={btnPrimary}>Save branding</button></div>
            </form>
          </Section>

          <Section title="Plan" desc={campus ? "This campus follows its university's plan" : "Decides which modules this institution has"}>
            {campus ? (
              <p className="text-[13px] text-cx-text-2">Plan: <span className="font-medium text-cx-text">{plans.find((p) => p.code === s.plan)?.name ?? s.plan}</span>. Change it on the university.</p>
            ) : (
              <form action={setPlan} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value="school" />
                <div className="min-w-[220px] flex-1">
                  <label className={labelCls} htmlFor="p-plan">Plan</label>
                  <select id="p-plan" name="plan" defaultValue={s.plan ?? "standard"} className={inputCls}>
                    {plans.filter((p) => p.active || p.code === s.plan).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </select>
                </div>
                <button className={btnGhost}>Change plan</button>
              </form>
            )}
          </Section>

          <section className="rounded-lg border border-cx-bad/30 bg-cx-card">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold text-cx-text">{active ? "Suspend this institution" : "Reactivate this institution"}</h2>
                <p className="text-[12.5px] text-cx-muted">{active ? "Everyone at the school is signed out and sees a suspended notice until you turn it back on. No data is deleted." : "Restores sign-in for every student, parent and staff member."}</p>
              </div>
              <form action={setSchoolStatus}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="status" value={active ? "suspended" : "active"} />
                <button className={active ? btnDanger : btnPrimary}>{active ? "Suspend" : "Reactivate"}</button>
              </form>
            </div>
          </section>
        </div>

        <Section title="Modules" desc="From the plan, plus any exceptions for this institution" flush
          right={!campus && Object.keys(overrides).length ? (
            <form action={resetModules}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value="school" /><button className={btnGhost}>Reset to plan</button></form>
          ) : undefined}>
          <ul className="divide-y divide-cx-line">
            {MODULES.map((m) => {
              const on = !!mods[m.key];
              return (
                <li key={m.key}>
                  <form action={toggleModule} className="flex items-center justify-between gap-3 px-5 py-3">
                    <input type="hidden" name="id" value={s.id} /><input type="hidden" name="key" value={m.key} /><input type="hidden" name="kind" value="school" />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-cx-text">{m.label}</p>
                      <p className="text-[12px] text-cx-muted">{m.desc} · {m.key in overrides ? (overrides[m.key] ? "Added for this institution" : "Removed for this institution") : planMods[m.key] ? "In plan" : "Not in plan"}</p>
                    </div>
                    <button role="switch" aria-checked={on} disabled={campus} aria-label={`${m.label} module`} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-cx-text" : "bg-cx-line-strong"}`}>
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-4" : ""}`} />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </div>
  );
}
