import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear, headCount, modulesOf, attendanceAnalytics, enrollmentByClass } from "@/lib/console/tenant";
import { AttendanceTrend } from "@/components/console/charts";
import { MeterList } from "@/components/console/meter-list";
import { ZoneHeader, Kpi, Pill, kpiStrip } from "@/components/console/table";
import { Section, StatusBadge, TypeBadge, btnGhost } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const PAID = ["fees", "library", "homework", "admissions", "hr", "transport"];
const MODULE_LABEL: Record<string, string> = { fees: "Fees", library: "Library", homework: "Homework", admissions: "Admissions", hr: "HR and payroll", transport: "Transport" };
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function SchoolOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const base = `/console/school/${s.id}`;

  const [students, staff, classes, sections, year, { data: recent }] = await Promise.all([
    headCount(admin, "student", s.id),
    headCount(admin, "staff", s.id),
    headCount(admin, "class", s.id),
    headCount(admin, "section", s.id),
    currentYear(admin, s.id),
    admin.from("announcement").select("id, title, published_at").eq("school_id", s.id).order("published_at", { ascending: false }).limit(5),
  ]);
  const mods = modulesOf(s.modules);
  const [att, enrol] = year ? await Promise.all([attendanceAnalytics(s.id, year.id), enrollmentByClass(s.id, year.id)]) : [null, []];
  const maxClass = Math.max(1, ...enrol.map((e) => e.students));

  return (
    <div>
      <ZoneHeader
        title={s.name}
        sub={s.place ?? undefined}
        badges={<><TypeBadge kind={s.university_id ? "campus" : (s as { institution_type?: string }).institution_type === "college" ? "college" : "school"} /><StatusBadge status={s.status} /></>}
      >
        <a href={`https://${s.slug}.${BASE}`} target="_blank" rel="noreferrer" className={btnGhost}>Open portal <Icon name="external" size={14} /></a>
      </ZoneHeader>

      <div className={kpiStrip}>
        <Kpi label="Students" value={students} href={`${base}/students`} />
        <Kpi label="Staff" value={staff} href={`${base}/staff`} />
        <Kpi label="Classes" value={classes} sub={`${sections} sections`} href={`${base}/classes`} />
      </div>

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
        <Section title="Students per class" flush>
          <MeterList rows={enrol.map((e) => ({ label: e.name, value: e.students }))} max={maxClass} format={(v) => v.toLocaleString("en-IN")} />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Recent announcements" flush right={<Link href={`${base}/announcements`} className="text-[13px] text-cx-link hover:underline">View all</Link>}>
            {(recent ?? []).length > 0 ? (
              <ul className="divide-y divide-cx-line">
                {(recent ?? []).map((a) => (
                  <li key={a.id} className="flex h-10 items-center justify-between gap-3 px-5 text-[13.5px]">
                    <span className="min-w-0 truncate text-cx-text">{a.title}</span>
                    <span className="shrink-0 text-[12.5px] tabular-nums text-cx-muted">{fmtDate(a.published_at)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-6 text-[13px] text-cx-muted">No announcements yet</p>}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Academic year" flush>
            {year ? (
              <dl className="divide-y divide-cx-line text-[13px]">
                <div className="flex h-10 items-center justify-between px-5"><dt className="text-cx-muted">Session</dt><dd className="font-medium text-cx-text">{year.name}</dd></div>
                <div className="flex h-10 items-center justify-between px-5"><dt className="text-cx-muted">Runs</dt><dd className="tabular-nums text-cx-text-2">{fmtDate(year.start_date)} to {fmtDate(year.end_date)}</dd></div>
              </dl>
            ) : <p className="px-5 py-6 text-[13px] text-cx-muted">No academic year set</p>}
          </Section>

          <Section title="Modules" flush right={<Link href={`${base}/settings`} className="text-[13px] text-cx-link hover:underline">Manage</Link>}>
            <dl className="divide-y divide-cx-line text-[13px]">
              {PAID.map((m) => (
                <div key={m} className="flex h-9 items-center justify-between px-5">
                  <dt className="text-cx-text-2">{MODULE_LABEL[m]}</dt>
                  <dd><Pill tone={mods[m] ? "green" : "slate"}>{mods[m] ? "On" : "Off"}</Pill></dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
