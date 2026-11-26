import { getCurrentYear } from "@/lib/session";
import { getStaffScope } from "@/lib/data/scope";
import { getFeeHeads, getFeeStructure } from "@/lib/data/fees";
import { EmptyState } from "@/components/ui/empty";
import { FeeHeadsManager, FeeStructureGrid } from "@/components/fees/fees-office";
import { HeadOptions } from "@/components/fees/fees-plan";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function FeeStructurePage() {
  const [year, scope] = await Promise.all([getCurrentYear(), getStaffScope()]);
  if (!year) return <EmptyState title="No academic year is set as current" />;
  const supabase = await createClient();
  const [heads, structure, { count: paidRoutes }] = await Promise.all([
    getFeeHeads(), getFeeStructure(year.id),
    supabase.from("route").select("id", { count: "exact", head: true }).gt("annual_fee", 0),
  ]);
  // Transport is charged per bus route. A fee head for it as well would bill
  // riders twice and bill children who do not take the bus.
  const transportHead = heads.find((h) => h.is_active && /transport|bus/i.test(h.name));
  return (
    <div className="space-y-5">
      {transportHead && (
        <p role="alert" className="rounded-sm border border-[#F2C94C] bg-[#FFF8E1] px-4 py-3 text-[14px] text-ink-900">
          {paidRoutes
            ? <>The <strong>{transportHead.name}</strong> fee head charges every student, and bus routes also charge their riders. Switch the head off below so riders are not billed twice.</>
            : <>Transport is best charged per bus route, so only children who take the bus pay. Set each route&apos;s yearly fee in <Link href="/dashboard/settings/transport" className="font-medium text-[#0F6CBD] underline">Buses and routes</Link>, then switch off the <strong>{transportHead.name}</strong> head.</>}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="self-start"><FeeHeadsManager heads={heads} /></div>
        <FeeStructureGrid classes={scope.classes} heads={heads.filter((h) => h.is_active)} structure={structure} yearName={year.name} />
      </div>
      <HeadOptions heads={heads.filter((h) => h.is_active)} />
    </div>
  );
}
