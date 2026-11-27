import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { setsAttendanceRules } from "@/lib/roles";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { AttendanceRules } from "@/components/settings/attendance-rules";

// Settings → Attendance lock and holds (colleges and universities).
export default async function AttendanceRulesPage() {
  const denied = await guardTab("/dashboard/settings/attendance-rules");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const [{ data: sch }, { data: sem }, { data: lab }] = await Promise.all([
    supabase.from("school").select("attendance_lock_mode, attendance_edit_days, attendance_minimum, condone_floor, hold_results_fees, relax_chain" as "id").eq("id", session?.schoolId ?? 0).maybeSingle(),
    supabase.from("semester" as never).select("attendance_cutoff, ends_on").eq("is_current", true).maybeSingle(),
    supabase.rpc("chain_labels" as never),
  ]);
  const s = sch as unknown as { attendance_lock_mode: string; attendance_edit_days: number; attendance_minimum: number; condone_floor: number | null; hold_results_fees: boolean; relax_chain: Record<string, string[]> };
  const cur = sem as unknown as { attendance_cutoff: string | null; ends_on: string } | null;
  return (
    <div className="space-y-4">
      <PageHeader title="Attendance lock and holds" description="How lecture attendance locks, when hall tickets and results are held back, and who approves relaxations." />
      <AttendanceRules initial={{ mode: s.attendance_lock_mode, days: String(s.attendance_edit_days), minimum: String(Number(s.attendance_minimum)), floor: s.condone_floor == null ? "" : String(Number(s.condone_floor)),
        holdFees: s.hold_results_fees, cutoff: cur?.attendance_cutoff ?? "", chain: s.relax_chain }} hasSemester={!!cur}
        canEdit={setsAttendanceRules(session)} labels={(lab ?? {}) as unknown as Record<string, string | null>} />
    </div>
  );
}
