import { getCurrentYear } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getInstalments } from "@/lib/data/fees";
import { EmptyState } from "@/components/ui/empty";
import { InstalmentPlanner } from "@/components/fees/fees-plan";

export default async function InstalmentsPage() {
  const year = await getCurrentYear();
  if (!year) return <EmptyState title="No academic year is set as current" />;
  const supabase = await createClient();
  const [instalments, { data: yr }] = await Promise.all([
    getInstalments(year.id),
    supabase.from("academic_year").select("start_date").eq("id", year.id).single(),
  ]);
  return <InstalmentPlanner instalments={instalments} yearStart={yr?.start_date ?? `${new Date().getFullYear()}-04-01`} yearName={year.name} />;
}
