import { getCurrentYear } from "@/lib/session";
import { getStaffScope } from "@/lib/data/scope";
import { getFeeHeads, getFeeStructure } from "@/lib/data/fees";
import { EmptyState } from "@/components/ui/empty";
import { FeeHeadsManager, FeeStructureGrid } from "@/components/fees/fees-office";
import { HeadOptions } from "@/components/fees/fees-plan";

export default async function FeeStructurePage() {
  const [year, scope] = await Promise.all([getCurrentYear(), getStaffScope()]);
  if (!year) return <EmptyState title="No academic year is set as current" />;
  const [heads, structure] = await Promise.all([getFeeHeads(), getFeeStructure(year.id)]);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="self-start"><FeeHeadsManager heads={heads} /></div>
        <FeeStructureGrid classes={scope.classes} heads={heads.filter((h) => h.is_active)} structure={structure} yearName={year.name} />
      </div>
      <HeadOptions heads={heads.filter((h) => h.is_active)} />
    </div>
  );
}
