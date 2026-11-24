import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear, attendanceAnalytics } from "@/lib/console/tenant";
import { ZoneHeader, SessionTag } from "@/components/console/table";
import { Section } from "@/components/console/ui";
import { AttendanceTrend } from "@/components/console/charts";
import { MeterList } from "@/components/console/meter-list";

const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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
  const att = year ? await attendanceAnalytics(s.id, year.id) : null;
  const latest = att?.latest ?? null;

  let marked = 0, present = 0, late = 0, holiday = 0;
  if (latest) {
    [marked, present, late, holiday] = await Promise.all([
      dayCount(admin, s.id, latest), dayCount(admin, s.id, latest, "present"), dayCount(admin, s.id, latest, "late"), dayCount(admin, s.id, latest, "holiday"),
    ]);
  }
  const absent = Math.max(0, marked - present - late - holiday);
  const seg = (n: number) => (marked ? `${(n / marked) * 100}%` : "0%");

  if (!latest) {
    return (
      <div>
        <ZoneHeader title="Attendance"><SessionTag name={year?.name} /></ZoneHeader>
        <p className="rounded-lg border border-cx-line bg-cx-card px-5 py-10 text-center text-[13px] text-cx-muted">No attendance has been marked this session</p>
      </div>
    );
  }

  return (
    <div>
      <ZoneHeader title="Attendance"><SessionTag name={year?.name} /></ZoneHeader>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section
            title="Attendance rate"
            desc="Weekly share of students present or late"
            right={att?.rate30 != null ? <div className="text-right"><p className="text-[22px] font-semibold leading-7 tabular-nums text-cx-text">{att.rate30.toFixed(1)}%</p><p className="text-[12px] text-cx-muted">last 30 days</p></div> : undefined}
          >
            {att && att.weekly.length > 1 ? <AttendanceTrend data={att.weekly} /> : <p className="py-10 text-center text-[13px] text-cx-muted">Not enough attendance marked yet</p>}
          </Section>
        </div>
        <Section title="By class" desc="Last 30 days" flush>
          <MeterList
            rows={(att?.byClass ?? []).map((c) => ({ label: c.name, value: c.rate }))}
            max={100}
            format={(v) => `${v.toFixed(1)}%`}
            marker={att?.rate30 ?? undefined}
            markerLabel={att?.rate30 != null ? `School average ${att.rate30.toFixed(1)}%` : undefined}
          />
        </Section>
      </div>

      <Section title="Last marked day" desc={`${fmt(latest)}, ${marked.toLocaleString("en-IN")} students marked`}>
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
          <div className="bg-cx-ok" style={{ width: seg(present) }} />
          <div className="bg-cx-warn" style={{ width: seg(late) }} />
          <div className="bg-cx-bad" style={{ width: seg(absent) }} />
          {holiday > 0 && <div className="bg-cx-line-strong" style={{ width: seg(holiday) }} />}
        </div>
        <div className="mt-3 flex flex-wrap gap-5 text-[13px] text-cx-text-2">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cx-ok" />Present <b className="font-semibold tabular-nums text-cx-text">{present.toLocaleString("en-IN")}</b></span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cx-warn" />Late <b className="font-semibold tabular-nums text-cx-text">{late.toLocaleString("en-IN")}</b></span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cx-bad" />Absent <b className="font-semibold tabular-nums text-cx-text">{absent.toLocaleString("en-IN")}</b></span>
          {holiday > 0 && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cx-line-strong" />Holiday <b className="font-semibold tabular-nums text-cx-text">{holiday.toLocaleString("en-IN")}</b></span>}
        </div>
      </Section>
    </div>
  );
}
