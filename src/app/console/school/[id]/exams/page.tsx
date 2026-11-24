import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, sectionClassMaps } from "@/lib/console/tenant";
import { ConsoleTable, SearchForm, Pager, Pill, Kpi, ZoneHeader, type Col, kpiStrip } from "@/components/console/table";

const SIZE = 50;
type Row = { id: number; name: string; section_id: number; subject_id: number; max_marks: number; assessed_on: string; is_published: boolean; term: number | null };

export default async function ExamsZone({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const safe = q.replace(/[,()\\%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const base = `/console/school/${s.id}/exams`;

  let query = admin.from("assessment").select("id, name, section_id, subject_id, max_marks, assessed_on, is_published, term", { count: "exact" }).eq("school_id", s.id);
  if (safe) query = query.ilike("name", `%${safe}%`);
  const [{ data, count }, { count: marks }, { count: published }, { data: subjects }, maps] = await Promise.all([
    query.order("assessed_on", { ascending: false }).range((page - 1) * SIZE, page * SIZE - 1),
    admin.from("mark").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("assessment").select("*", { count: "exact", head: true }).eq("school_id", s.id).eq("is_published", true),
    admin.from("subject").select("id, name").eq("school_id", s.id),
    sectionClassMaps(admin, s.id),
  ]);
  const rows = (data ?? []) as Row[];
  const subjectName = new Map((subjects ?? []).map((x) => [x.id, x.name]));

  const cols: Col<Row>[] = [
    { key: "name", label: "Assessment", render: (r) => <span className="font-medium text-cx-text">{r.name}</span> },
    { key: "class", label: "Class", render: (r) => <span className="text-cx-text-2">{maps.sectionLabel.get(r.section_id) ?? "—"}</span> },
    { key: "subject", label: "Subject", render: (r) => <span className="text-cx-text-2">{subjectName.get(r.subject_id) ?? "—"}</span> },
    { key: "max", label: "Max", align: "right", render: (r) => r.max_marks },
    { key: "date", label: "Date", render: (r) => <span className="text-cx-muted">{new Date(r.assessed_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span> },
    { key: "pub", label: "Status", render: (r) => <Pill tone={r.is_published ? "green" : "amber"}>{r.is_published ? "published" : "draft"}</Pill> },
  ];

  return (
    <div>
      <ZoneHeader title="Exams & marks" />
      <div className={kpiStrip}>
        <Kpi label="Assessments" value={count ?? 0} />
        <Kpi label="Published" value={published ?? 0} />
        <Kpi label="Marks recorded" value={marks ?? 0} />
        <Kpi label="Subjects" value={subjectName.size} />
      </div>
      <div className="mb-3"><SearchForm action={base} defaultValue={q} placeholder="Search assessments" /></div>
      <ConsoleTable columns={cols} rows={rows} rowKey={(r) => r.id} empty={q ? `No assessments match “${q}”` : "No assessments yet."} />
      <Pager page={page} pageSize={SIZE} total={count ?? 0} hrefFor={(p) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} />
    </div>
  );
}
