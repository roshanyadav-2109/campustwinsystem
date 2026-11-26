import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { SubstitutionBoard, type Need } from "@/components/attendance/substitutions";

type SP = Promise<Record<string, string | string[] | undefined>>;
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// Substitutions: lessons of teachers who are away, with free teachers suggested.
export default async function SubstitutionsPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/substitutions");
  if (denied) return denied;
  const sp = await searchParams;
  const raw = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayIST();
  const supabase = await createClient();
  const { data } = await supabase.rpc("substitution_needs" as never, { p_date: date } as never);
  return (
    <div className="space-y-4">
      <PageHeader title="Substitutions" description="Lessons of teachers who are absent or on leave (from staff attendance and approved leave), with free teachers suggested: those who teach the subject or the class first, then the least busy." />
      <SubstitutionBoard key={date} date={date} needs={(data ?? []) as unknown as Need[]} />
    </div>
  );
}
