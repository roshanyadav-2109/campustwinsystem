import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip } from "@/components/console/table";
import { Section } from "@/components/console/ui";

async function dayCount(admin: ReturnType<typeof createAdminClient>, schoolId: number, date: string, status?: string) {
  let q = admin.from("attendance_record").select("*", { count: "exact", head: true }).eq("school_id", schoolId).eq("on_date", date).is("period", null);
  if (status) q = q.eq("status", status as never);
  const { count } = await q;
  return count ?? 0;
}

export default async function AttendanceZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const year = await currentYear(admin, s.id);

  const [{ count: total }, { data: latestRow }] = await Promise.all([
    admin.from("attendance_record").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("attendance_record").select("on_date").eq("school_id", s.id).order("on_date", { ascending: false }).limit(1),
  ]);
  const latest = latestRow?.[0]?.on_date as string | undefined;

  let marked = 0, present = 0, late = 0, holiday = 0;
  if (latest) {
    [marked, present, late, holiday] = await Promise.all([
      dayCount(admin, s.id, latest), dayCount(admin, s.id, latest, "present"), dayCount(admin, s.id, latest, "late"), dayCount(admin, s.id, latest, "holiday"),
    ]);
  }
  const absent = Math.max(0, marked - present - late - holiday);
  const pct = marked - holiday > 0 ? Math.round(((present + late) / (marked - holiday)) * 100) : 0;
  const seg = (n: number) => (marked ? `${(n / marked) * 100}%` : "0%");

  return (
    <div>
      <ZoneHeader title="Attendance" sub={year ? year.name : undefined} />
      <div className={kpiStrip}>
        <Kpi label="Records (all time)" value={total ?? 0} />
        <Kpi label="Last marked" value={latest ? new Date(latest).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
        <Kpi label="Marked that day" value={marked} />
        <Kpi label="Attendance rate" value={`${pct}%`} sub="present + late" />
      </div>

      {latest ? (
        <Section title={`Breakdown — ${new Date(latest).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-cx-raised">
            <div className="bg-cx-ok" style={{ width: seg(present) }} title={`Present ${present}`} />
            <div className="bg-cx-warn" style={{ width: seg(late) }} title={`Late ${late}`} />
            <div className="bg-cx-bad" style={{ width: seg(absent) }} title={`Absent ${absent}`} />
            <div className="bg-cx-line-strong" style={{ width: seg(holiday) }} title={`Holiday ${holiday}`} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[12.5px]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cx-ok" />Present <b className="tabular-nums">{present.toLocaleString("en-IN")}</b></span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cx-warn" />Late <b className="tabular-nums">{late.toLocaleString("en-IN")}</b></span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cx-bad" />Absent <b className="tabular-nums">{absent.toLocaleString("en-IN")}</b></span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cx-line-strong" />Holiday <b className="tabular-nums">{holiday.toLocaleString("en-IN")}</b></span>
          </div>
        </Section>
      ) : (
        <p className="rounded-lg border border-dashed border-cx-line px-4 py-10 text-center text-[13px] text-cx-muted">No attendance has been marked yet.</p>
      )}
    </div>
  );
}
