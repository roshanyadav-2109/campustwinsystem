import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear, headCount, modulesOf } from "@/lib/console/tenant";
import { ZoneHeader, Kpi, Pill } from "@/components/console/table";
import { Section, StatusBadge, TypeBadge } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const PAID = ["fees", "library", "homework", "admissions", "hr", "transport"];

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
      <ZoneHeader title="Overview" sub={`${s.slug}.${BASE}${s.place ? ` · ${s.place}` : ""}`}>
        <TypeBadge kind={s.university_id ? "campus" : "school"} />
        <StatusBadge status={s.status} />
        <a href={`https://${s.slug}.${BASE}`} target="_blank" rel="noreferrer" className="rounded-md border border-hair bg-white px-3 py-2 text-[13px] font-medium text-ink-700 hover:bg-panel">Open portal ↗</a>
      </ZoneHeader>

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Students" value={students} href={`${base}/students`} />
        <Kpi label="Staff" value={staff} href={`${base}/staff`} />
        <Kpi label="Guardians" value={guardians} href={`${base}/guardians`} />
        <Kpi label="Classes" value={classes} href={`${base}/classes`} />
        <Kpi label="Sections" value={sections} href={`${base}/classes`} />
        <Kpi label="Logins" value={logins} href={`${base}/access`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Recent announcements" right={<Link href={`${base}/announcements`} className="text-[12px] font-medium text-[#0F6CBD] hover:underline">View all</Link>}>
            {(recent ?? []).length > 0 ? (
              <ul className="divide-y divide-hair">
                {(recent ?? []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="min-w-0 truncate text-ink-800">{a.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Pill tone="sky">{a.scope}</Pill>
                      <span className="text-[11.5px] text-ink-400">{new Date(a.published_at).toLocaleDateString()}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-center text-[13px] text-ink-500">No announcements yet.</p>}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Academic year">
            {year ? (
              <div className="text-[13px]">
                <p className="font-medium text-ink-900">{year.name}{year.is_current && <span className="ml-2 align-middle"><Pill tone="green">current</Pill></span>}</p>
                <p className="mt-0.5 text-[12px] text-ink-500">{year.start_date} → {year.end_date}</p>
              </div>
            ) : <p className="text-[13px] text-ink-500">No academic year set.</p>}
          </Section>

          <Section title="Modules" right={<Link href={`${base}/settings`} className="text-[12px] font-medium text-[#0F6CBD] hover:underline">Manage</Link>}>
            <div className="flex flex-wrap gap-1.5">
              {PAID.map((m) => <Pill key={m} tone={mods[m] ? "green" : "slate"}>{mods[m] ? m : `${m} off`}</Pill>)}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
