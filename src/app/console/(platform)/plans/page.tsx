import { createAdminClient } from "@/lib/supabase/admin";
import { ZoneHeader } from "@/components/console/table";
import { Section } from "@/components/console/ui";
import { PlanForm, type PlanRow } from "@/components/console/plan-form";

// CampusTwin plans. A plan decides which modules an institution has; changing
// a plan here changes every institution on it.
export default async function PlansPage() {
  const admin = createAdminClient();
  const [{ data: plans }, { data: schools }, { data: unis }] = await Promise.all([
    admin.schema("core" as never).from("plan" as never).select("id, code, name, price_paise, features, active").eq("product_code", "campustwin").order("price_paise").order("created_at"),
    admin.from("school").select("plan, university_id"),
    admin.from("university").select("plan"),
  ]);
  const count = (code: string) =>
    ((schools ?? []) as { plan: string; university_id: number | null }[]).filter((s) => s.plan === code && !s.university_id).length +
    ((unis ?? []) as { plan: string }[]).filter((u) => u.plan === code).length;
  const rows: PlanRow[] = ((plans ?? []) as { id: string; code: string; name: string; price_paise: number; features: { modules?: Record<string, boolean> } | null; active: boolean }[])
    .map((p) => ({ id: p.id, code: p.code, name: p.name, priceRupees: Math.round(Number(p.price_paise) / 100), modules: p.features?.modules ?? {}, active: p.active, schools: count(p.code) }));

  return (
    <div>
      <ZoneHeader title="Plans" />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {rows.map((p) => (
          <Section key={p.id} title={p.name} desc={`Code ${p.code}${p.active ? "" : ", not offered"}`}>
            <PlanForm plan={p} />
          </Section>
        ))}
        <Section title="New plan" desc="Add a plan, then move institutions to it from their settings">
          <PlanForm />
        </Section>
      </div>
    </div>
  );
}
