import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear, sectionClassMaps, studentBreakdown, humanize } from "@/lib/console/tenant";
import { ConsoleTable, SearchForm, Pager, Avatar, Pill, ZoneHeader, type Col, SessionTag } from "@/components/console/table";
import { Section, btnGhost } from "@/components/console/ui";
import { MeterList } from "@/components/console/meter-list";

const SIZE = 50;
type Row = { id: number; full_name: string; admission_no: string; status: string; photo_path: string | null };

export default async function StudentsZone({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const safe = q.replace(/[,()\\%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const base = `/console/school/${s.id}/students`;

  let query = admin.from("student").select("id, full_name, admission_no, status, photo_path", { count: "exact" }).eq("school_id", s.id);
  if (safe) query = query.or(`full_name.ilike.%${safe}%,admission_no.ilike.%${safe}%`);
  const [{ data, count }, year, maps, breakdown] = await Promise.all([
    query.order("full_name").range((page - 1) * SIZE, page * SIZE - 1),
    currentYear(admin, s.id),
    sectionClassMaps(admin, s.id),
    studentBreakdown(s.id),
  ]);
  const rows = (data ?? []) as Row[];

  const classOf = new Map<number, number>();
  if (year && rows.length) {
    const { data: enr } = await admin.from("student_enrollment").select("student_id, section_id").eq("school_id", s.id).eq("academic_year_id", year.id).in("student_id", rows.map((r) => r.id));
    for (const e of enr ?? []) classOf.set(e.student_id, e.section_id);
  }

  const totalActive = breakdown.gender.reduce((n, g) => n + g.value, 0);
  const totalAll = breakdown.status.reduce((n, g) => n + g.value, 0);

  const cols: Col<Row>[] = [
    { key: "name", label: "Student", render: (r) => (
      <div className="flex items-center gap-2.5 py-1">
        <Avatar src={r.photo_path} name={r.full_name} />
        <div className="min-w-0"><div className="truncate font-medium text-cx-text">{r.full_name}</div><div className="text-[12px] text-cx-muted">{r.admission_no}</div></div>
      </div>
    ) },
    { key: "class", label: "Class", render: (r) => { const sec = classOf.get(r.id); return sec ? maps.sectionLabel.get(sec) ?? "" : <span className="text-cx-muted">Not enrolled</span>; } },
    { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "active" ? "green" : "slate"}>{humanize(r.status)}</Pill> },
  ];

  return (
    <div>
      <ZoneHeader title="Students"><SessionTag name={year?.name} /></ZoneHeader>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Section title="Enrolled students by gender" flush>
          <MeterList rows={breakdown.gender.map((g) => ({ label: humanize(g.label), value: g.value }))} max={Math.max(1, totalActive)} format={(v) => v.toLocaleString("en-IN")} labelWidth={110} />
        </Section>
        <Section title="All students by status" flush>
          <MeterList rows={breakdown.status.map((g) => ({ label: humanize(g.label), value: g.value }))} max={Math.max(1, totalAll)} format={(v) => v.toLocaleString("en-IN")} labelWidth={110} />
        </Section>
      </div>

      <Section
        title={q ? `Students matching ${q}` : "All students"}
        flush
        right={<a href={`${base}/export`} className={btnGhost}>Export CSV</a>}
      >
        <div className="border-b border-cx-line px-5 py-3"><SearchForm action={base} defaultValue={q} placeholder="Search by name or admission number" /></div>
        <ConsoleTable bare columns={cols} rows={rows} rowKey={(r) => r.id} empty={q ? `No students match ${q}` : "No students"} />
        <div className="border-t border-cx-line px-5 pb-3"><Pager page={page} pageSize={SIZE} total={count ?? 0} hrefFor={(p) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} /></div>
      </Section>
    </div>
  );
}
