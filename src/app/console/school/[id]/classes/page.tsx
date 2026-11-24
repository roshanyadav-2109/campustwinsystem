import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear, type Admin } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip, SessionTag } from "@/components/console/table";
import { Section } from "@/components/console/ui";

async function enrollmentBySection(admin: Admin, schoolId: number, yearId: number) {
  const tally = new Map<number, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("student_enrollment").select("section_id").eq("school_id", schoolId).eq("academic_year_id", yearId).neq("status", "transferred").range(from, from + 999);
    for (const e of data ?? []) tally.set(e.section_id, (tally.get(e.section_id) ?? 0) + 1);
    if (!data || data.length < 1000) break;
  }
  return tally;
}

// Everything comes from the institution's own classes and sections, in the order
// it set them up. No assumed stages, names or capacity limits.
export default async function ClassesZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const [{ data: classes }, { data: sections }, year] = await Promise.all([
    admin.from("class").select("id, name, level").eq("school_id", s.id).order("level").order("name"),
    admin.from("section").select("id, name, class_id").eq("school_id", s.id),
    currentYear(admin, s.id),
  ]);
  const tally = year ? await enrollmentBySection(admin, s.id, year.id) : new Map<number, number>();
  const n = (v: number) => v.toLocaleString("en-IN");

  const rows = (classes ?? []).map((c) => {
    const secs = (sections ?? [])
      .filter((x) => x.class_id === c.id)
      .map((x) => ({ id: x.id, name: x.name, students: tally.get(x.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    return { ...c, secs, students: secs.reduce((t, x) => t + x.students, 0) };
  });
  const allSecs = rows.flatMap((r) => r.secs);
  const enrolled = allSecs.reduce((t, x) => t + x.students, 0);
  const filled = allSecs.filter((x) => x.students > 0);
  const avg = filled.length ? Math.round(enrolled / filled.length) : 0;

  return (
    <div>
      <ZoneHeader title="Classes and sections"><SessionTag name={year?.name} /></ZoneHeader>

      <div className={kpiStrip}>
        <Kpi label="Classes" value={rows.length} />
        <Kpi label="Sections" value={allSecs.length} />
        <Kpi label="Students enrolled" value={enrolled} />
        <Kpi label="Average per section" value={avg} />
      </div>

      <Section flush>
        <div className="grid grid-cols-[minmax(88px,auto)_1fr_auto] gap-5 border-b border-cx-line bg-cx-raised/60 px-5 py-2.5 text-[13px] font-medium text-cx-text-2">
          <span>Class</span><span>Sections and students in each</span><span className="text-right">Students</span>
        </div>
        <ul className="divide-y divide-cx-line">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[minmax(88px,auto)_1fr_auto] items-center gap-5 px-5 py-3">
              <span className="text-[15px] font-semibold text-cx-text">{r.name}</span>
              <span className="flex flex-wrap gap-1.5">
                {r.secs.map((x) => (
                  <span key={x.id} className="inline-flex min-w-12 flex-col items-center rounded-md border border-cx-line bg-cx-card px-2 py-1">
                    <span className="text-[11.5px] leading-4 text-cx-muted">{x.name}</span>
                    <span className="text-[13px] font-medium leading-4 tabular-nums text-cx-text">{x.students}</span>
                  </span>
                ))}
                {r.secs.length === 0 && <span className="text-[13px] text-cx-muted">No sections yet</span>}
              </span>
              <span className="text-right text-[15px] font-semibold tabular-nums text-cx-text">{n(r.students)}</span>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <p className="px-5 py-10 text-center text-[13px] text-cx-muted">No classes set up yet</p>}
      </Section>
    </div>
  );
}
