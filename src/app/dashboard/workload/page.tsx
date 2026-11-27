import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { WorkloadLimits } from "@/components/courses/workload-limits";

type Row = { staff_id: number; staff_name: string; department: string | null; courses: string | null; sections: number; planned_hours: number; timetabled_periods: number; clashes: number; load: string };

// Faculty workload this semester (colleges and universities): weekly hours from the courses each
// teacher is allotted (lecture + tutorial + practical), timetabled periods and clashes.
export default async function WorkloadPage() {
  const denied = await guardTab("/dashboard/workload");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const { data: sem } = await supabase.from("semester" as never).select("id, kind, starts_on").eq("is_current", true).maybeSingle();
  const s = sem as unknown as { id: number; kind: string; starts_on: string } | null;
  if (!session || !s) return (<div><PageHeader title="Workload" /><EmptyState art="nothing-yet" title="No current semester" /></div>);
  const [{ data }, { data: lim }] = await Promise.all([
    supabase.rpc("faculty_workload" as never, { p_semester: s.id } as never),
    supabase.from("school").select("workload_max_hours, workload_min_hours" as "id").eq("id", session.schoolId).maybeSingle(),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const l = lim as unknown as { workload_max_hours: number; workload_min_hours: number } | null;
  const over = rows.filter((r) => r.load === "over").length, under = rows.filter((r) => r.load === "under").length, clash = rows.filter((r) => r.clashes > 0).length;
  return (
    <div className="space-y-4">
      <PageHeader title="Workload" description={`${s.kind === "odd" ? "Odd" : "Even"} semester ${s.starts_on.slice(0, 4)}. Weekly hours from the courses each teacher is allotted (lecture, tutorial and practical hours; an elective taught to several sections together counts once), against ${l?.workload_min_hours ?? 8} to ${l?.workload_max_hours ?? 18} hours.`} />
      {(session.staffRole === "office" || session.staffRole === "principal") && <WorkloadLimits min={l?.workload_min_hours ?? 8} max={l?.workload_max_hours ?? 18} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Teachers", rows.length], ["Overloaded", over], ["Underloaded", under], ["Timetable clashes", clash]].map(([k, v]) => (
          <div key={k as string} className="rounded-sm border border-hair bg-white p-3"><div className="text-[22px] font-semibold tabular">{v}</div><div className="text-[12px] text-ink-700">{k}</div></div>
        ))}
      </div>
      <Card>
        <CardHeader title="By teacher" />
        <CardBody className="p-0">
          {rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No courses are allotted to teachers this semester.</p> : (
            <table className="w-full text-[13px]">
              <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Teacher</th><th className="px-4 py-2 font-medium">Department</th><th className="px-4 py-2 font-medium">Courses</th>
                <th className="px-4 py-2 text-right font-medium">Sections</th><th className="px-4 py-2 text-right font-medium">Hours a week</th><th className="px-4 py-2 text-right font-medium">Timetabled</th><th className="px-4 py-2 font-medium">Note</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.staff_id} className="border-t border-hair">
                  <td className="px-4 py-1.5 font-medium">{r.staff_name}</td><td className="px-4 py-1.5">{r.department ?? "-"}</td><td className="px-4 py-1.5">{r.courses ?? "-"}</td>
                  <td className="px-4 py-1.5 text-right tabular">{r.sections}</td>
                  <td className={`px-4 py-1.5 text-right tabular ${r.load === "over" ? "text-down" : r.load === "under" ? "text-ink-500" : ""}`}>{Number(r.planned_hours)}</td>
                  <td className="px-4 py-1.5 text-right tabular">{r.timetabled_periods}</td>
                  <td className="px-4 py-1.5 text-[12px]">{[r.load === "over" ? "overloaded" : r.load === "under" ? "underloaded" : "", r.clashes ? `${r.clashes} timetable clash${r.clashes > 1 ? "es" : ""}` : ""].filter(Boolean).join(", ")}</td>
                </tr>))}</tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
