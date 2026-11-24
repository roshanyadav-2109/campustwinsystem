import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear, sectionClassMaps } from "@/lib/console/tenant";
import { ConsoleTable, SearchForm, Pager, Avatar, Pill, ZoneHeader, type Col } from "@/components/console/table";

const SIZE = 50;
type Row = { id: number; full_name: string; admission_no: string; gender: string | null; status: string; phone: string | null; photo_path: string | null };

export default async function StudentsZone({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const safe = q.replace(/[,()\\%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const base = `/console/school/${s.id}/students`;

  let query = admin.from("student").select("id, full_name, admission_no, gender, status, phone, photo_path", { count: "exact" }).eq("school_id", s.id);
  if (safe) query = query.or(`full_name.ilike.%${safe}%,admission_no.ilike.%${safe}%`);
  const { data, count } = await query.order("full_name").range((page - 1) * SIZE, page * SIZE - 1);
  const rows = (data ?? []) as Row[];

  const year = await currentYear(admin, s.id);
  const enrByStudent = new Map<number, { roll_no: number | null; section_id: number }>();
  if (year && rows.length) {
    const { data: enr } = await admin.from("student_enrollment").select("student_id, roll_no, section_id").eq("school_id", s.id).eq("academic_year_id", year.id).in("student_id", rows.map((r) => r.id));
    for (const e of enr ?? []) enrByStudent.set(e.student_id, { roll_no: e.roll_no, section_id: e.section_id });
  }
  const { sectionLabel } = await sectionClassMaps(admin, s.id);

  const cols: Col<Row>[] = [
    { key: "name", label: "Student", render: (r) => (
      <div className="flex items-center gap-2.5">
        <Avatar src={r.photo_path} name={r.full_name} />
        <div className="min-w-0"><div className="truncate font-medium text-cx-text">{r.full_name}</div><div className="text-[11.5px] text-cx-muted">{r.admission_no}</div></div>
      </div>
    ) },
    { key: "class", label: "Class", render: (r) => { const e = enrByStudent.get(r.id); return e ? sectionLabel.get(e.section_id) ?? "—" : <span className="text-cx-muted">—</span>; } },
    { key: "roll", label: "Roll", align: "right", render: (r) => enrByStudent.get(r.id)?.roll_no ?? <span className="text-cx-muted">—</span> },
    { key: "gender", label: "Gender", render: (r) => <span className="capitalize text-cx-text-2">{r.gender ?? "—"}</span> },
    { key: "phone", label: "Phone", render: (r) => <span className="text-cx-text-2">{r.phone ?? "—"}</span> },
    { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "active" ? "green" : "slate"}>{r.status}</Pill> },
  ];

  return (
    <div>
      <ZoneHeader title="Students" sub={`${(count ?? 0).toLocaleString("en-IN")} enrolled${year ? ` · ${year.name}` : ""}`} />
      <div className="mb-3"><SearchForm action={base} defaultValue={q} placeholder="Search by name or admission number" /></div>
      <ConsoleTable columns={cols} rows={rows} rowKey={(r) => r.id} empty={q ? `No students match “${q}”` : "No students."} />
      <Pager page={page} pageSize={SIZE} total={count ?? 0} hrefFor={(p) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} />
    </div>
  );
}
