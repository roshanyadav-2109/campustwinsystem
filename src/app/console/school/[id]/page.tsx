import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear, headCount, modulesOf } from "@/lib/console/tenant";
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

  const [students, staff, guardians, classes, sections, logins, year] = await Promise.all([
    headCount(admin, "student", s.id),
    headCount(admin, "staff", s.id),
    headCount(admin, "guardian", s.id),
    headCount(admin, "class", s.id),
    headCount(admin, "section", s.id),
    headCount(admin, "profile", s.id),
    currentYear(admin, s.id),
  ]);
  const { data: recent } = await admin
    .from("announcement")
    .select("id, title, scope, published_at")
    .eq("school_id", s.id)
    .order("published_at", { ascending: false })
    .limit(5);
  const mods = modulesOf(s.modules);

  return (
    <div>
      <ZoneHeader
        title={s.name}
        sub={`${s.slug}.${BASE}${s.place ? ` · ${s.place}` : ""}`}
        badges={<><TypeBadge kind={s.university_id ? "campus" : "school"} /><StatusBadge status={s.status} /></>}
      >
        <a href={`https://${s.slug}.${BASE}`} target="_blank" rel="noreferrer" className={btnGhost}>Open portal <Icon name="external" size={14} /></a>
      </ZoneHeader>

      <div className={kpiStrip}>
        <Kpi label="Students" value={students} href={`${base}/students`} />
        <Kpi label="Staff" value={staff} href={`${base}/staff`} />
        <Kpi label="Guardians" value={guardians} href={`${base}/guardians`} />
        <Kpi label="Classes" value={classes} href={`${base}/classes`} />
        <Kpi label="Sections" value={sections} href={`${base}/classes`} />
        <Kpi label="Logins" value={logins} href={`${base}/access`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Recent announcements" right={<Link href={`${base}/announcements`} className="text-[12px] font-medium text-cx-link hover:underline">View all</Link>}>
            {(recent ?? []).length > 0 ? (
              <ul className="divide-y divide-cx-line">
                {(recent ?? []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="min-w-0 truncate text-cx-text">{a.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Pill tone="sky">{a.scope}</Pill>
                      <span className="text-[11.5px] text-cx-muted">{new Date(a.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-center text-[13px] text-cx-muted">No announcements yet</p>}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Academic year" flush>
            {year ? (
              <dl className="divide-y divide-cx-line text-[13px]">
                <div className="flex h-10 items-center justify-between px-4"><dt className="text-cx-muted">Session</dt><dd className="font-medium text-cx-text">{year.name}{year.is_current && <span className="ml-2 font-normal"><Pill tone="green">Current</Pill></span>}</dd></div>
                <div className="flex h-10 items-center justify-between px-4"><dt className="text-cx-muted">Starts</dt><dd className="tabular-nums text-cx-text-2">{fmtDate(year.start_date)}</dd></div>
                <div className="flex h-10 items-center justify-between px-4"><dt className="text-cx-muted">Ends</dt><dd className="tabular-nums text-cx-text-2">{fmtDate(year.end_date)}</dd></div>
              </dl>
            ) : <p className="px-4 py-6 text-[13px] text-cx-muted">No academic year set</p>}
          </Section>

          <Section title="Modules" flush right={<Link href={`${base}/settings`} className="text-[13px] text-cx-link hover:underline">Manage</Link>}>
            <dl className="divide-y divide-cx-line text-[13px]">
              {PAID.map((m) => (
                <div key={m} className="flex h-9 items-center justify-between px-4">
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
