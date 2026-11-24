import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, sectionClassMaps, currentYear, assessmentStats } from "@/lib/console/tenant";
import { ConsoleTable, SearchForm, Pager, Pill, Kpi, ZoneHeader, type Col, kpiStrip, SessionTag } from "@/components/console/table";
import { Section, EmptyState } from "@/components/console/ui";
import { MeterList } from "@/components/console/meter-list";
import { ColumnBars } from "@/components/console/column-bars";
import { Icon } from "@/components/console/icons";

const SIZE = 25;
type Row = { id: number; name: string; section_id: number; subject_id: number; max_marks: number; assessed_on: string; is_published: boolean };
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function ExamsZone({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const safe = q.replace(/[,()\\%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const base = `/console/school/${s.id}/exams`;
  const year = await currentYear(admin, s.id);

  if (!year) {
    return (
      <div>
        <ZoneHeader title="Exams and marks" />
        <EmptyState icon={<Icon name="exams" size={22} />} title="No academic year set" body="Exams are grouped by session. Once the school sets its current academic year, assessments show here." />
      </div>
    );
  }

  let query = admin.from("assessment").select("id, name, section_id, subject_id, max_marks, assessed_on, is_published", { count: "exact" }).eq("school_id", s.id).eq("academic_year_id", year.id);
  if (safe) query = query.ilike("name", `%${safe}%`);
  const [{ data, count }, { data: subjects }, maps, stats] = await Promise.all([
    query.order("assessed_on", { ascending: false }).order("id").range((page - 1) * SIZE, page * SIZE - 1),
    admin.from("subject").select("id, name").eq("school_id", s.id),
    sectionClassMaps(admin, s.id),
    assessmentStats(s.id, year.id),
  ]);
  const rows = (data ?? []) as Row[];
  const subjectName = new Map((subjects ?? []).map((x) => [x.id, x.name]));
  const topSubjects = stats.bySubject.slice(0, 10);

  const cols: Col<Row>[] = [
    { key: "name", label: "Assessment", render: (r) => <span className="font-medium text-cx-text">{r.name}</span> },
    { key: "class", label: "Class", render: (r) => maps.sectionLabel.get(r.section_id) ?? "" },
    { key: "subject", label: "Subject", render: (r) => subjectName.get(r.subject_id) ?? "" },
    { key: "max", label: "Out of", align: "right", render: (r) => r.max_marks },
    { key: "date", label: "Held on", render: (r) => <span className="tabular-nums">{fmt(r.assessed_on)}</span> },
    { key: "pub", label: "Results", render: (r) => <Pill tone={r.is_published ? "green" : "amber"}>{r.is_published ? "Published" : "Not published"}</Pill> },
  ];

  return (
    <div>
      <ZoneHeader title="Exams and marks"><SessionTag name={year.name} /></ZoneHeader>

      <div className={kpiStrip}>
        <Kpi label="Assessments" value={stats.total} />
        <Kpi label="Subjects examined" value={stats.subjects} />
        <Kpi label="Sections covered" value={stats.sections} />
        <Kpi label="Latest exam" value={stats.latest ? fmt(stats.latest) : "None yet"} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title="Assessments by month" desc="Papers held each month" flush>
            <ColumnBars data={stats.byMonth} unit="assessments" />
          </Section>
        </div>
        <Section title="Most examined subjects" flush>
          <MeterList rows={topSubjects} max={Math.max(1, ...topSubjects.map((t) => t.value))} format={(v) => v.toLocaleString("en-IN")} labelWidth={124} />
        </Section>
      </div>

      <Section title={q ? `Assessments named ${q}` : "All assessments"} desc="Newest first" flush>
        <div className="border-b border-cx-line px-5 py-3"><SearchForm action={base} defaultValue={q} placeholder="Search by assessment name" /></div>
        <ConsoleTable bare columns={cols} rows={rows} rowKey={(r) => r.id} empty={q ? `No assessments named ${q}` : "No assessments yet"} />
        <div className="border-t border-cx-line px-5 pb-3"><Pager page={page} pageSize={SIZE} total={count ?? 0} hrefFor={(p) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} /></div>
      </Section>
    </div>
  );
}
