import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool } from "@/lib/console/tenant";
import { ConsoleTable, SearchForm, Pager, Avatar, Pill, ZoneHeader, type Col } from "@/components/console/table";

const SIZE = 50;
type Row = { id: number; full_name: string; role: string; employee_code: string | null; email: string | null; phone: string | null; photo_path: string | null };

export default async function StaffZone({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const safe = q.replace(/[,()\\%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const base = `/console/school/${s.id}/staff`;

  let query = admin.from("staff").select("id, full_name, role, employee_code, email, phone, photo_path", { count: "exact" }).eq("school_id", s.id);
  if (safe) query = query.or(`full_name.ilike.%${safe}%,employee_code.ilike.%${safe}%,email.ilike.%${safe}%`);
  const { data, count } = await query.order("full_name").range((page - 1) * SIZE, page * SIZE - 1);
  const rows = (data ?? []) as Row[];

  const cols: Col<Row>[] = [
    { key: "name", label: "Staff member", render: (r) => (
      <div className="flex items-center gap-2.5">
        <Avatar src={r.photo_path} name={r.full_name} />
        <div className="min-w-0"><div className="truncate font-medium text-ink-900">{r.full_name}</div><div className="text-[11.5px] text-ink-400">{r.employee_code ?? "—"}</div></div>
      </div>
    ) },
    { key: "role", label: "Role", render: (r) => <Pill tone="violet">{r.role.replace(/_/g, " ")}</Pill> },
    { key: "email", label: "Email", render: (r) => <span className="text-ink-600">{r.email ?? "—"}</span> },
    { key: "phone", label: "Phone", render: (r) => <span className="text-ink-600">{r.phone ?? "—"}</span> },
  ];

  return (
    <div>
      <ZoneHeader title="Staff" sub={`${(count ?? 0).toLocaleString()} staff members`} />
      <div className="mb-3"><SearchForm action={base} defaultValue={q} placeholder="Search by name, code or email…" /></div>
      <ConsoleTable columns={cols} rows={rows} rowKey={(r) => r.id} empty={q ? `No staff match “${q}”.` : "No staff."} />
      <Pager page={page} pageSize={SIZE} total={count ?? 0} hrefFor={(p) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} />
    </div>
  );
}
