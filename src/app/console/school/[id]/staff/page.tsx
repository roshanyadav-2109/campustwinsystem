import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, staffRoles, humanize } from "@/lib/console/tenant";
import { ConsoleTable, SearchForm, Pager, Avatar, ZoneHeader, type Col } from "@/components/console/table";
import { Section, btnGhost } from "@/components/console/ui";
import { MeterList } from "@/components/console/meter-list";

const SIZE = 50;
type Row = { id: number; full_name: string; role: string; employee_code: string | null; email: string | null; photo_path: string | null };

export default async function StaffZone({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const safe = q.replace(/[,()\\%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const base = `/console/school/${s.id}/staff`;

  let query = admin.from("staff").select("id, full_name, role, employee_code, email, photo_path", { count: "exact" }).eq("school_id", s.id);
  if (safe) query = query.or(`full_name.ilike.%${safe}%,employee_code.ilike.%${safe}%,email.ilike.%${safe}%`);
  const [{ data, count }, roles] = await Promise.all([query.order("full_name").range((page - 1) * SIZE, page * SIZE - 1), staffRoles(s.id)]);
  const rows = (data ?? []) as Row[];
  const total = roles.reduce((n, r) => n + r.value, 0);

  const cols: Col<Row>[] = [
    { key: "name", label: "Staff member", render: (r) => (
      <div className="flex items-center gap-2.5 py-1">
        <Avatar src={r.photo_path} name={r.full_name} />
        <div className="min-w-0"><div className="truncate font-medium text-cx-text">{r.full_name}</div><div className="text-[12px] text-cx-muted">{r.employee_code ?? "No employee code"}</div></div>
      </div>
    ) },
    { key: "role", label: "Role", render: (r) => humanize(r.role) },
    { key: "email", label: "Email", render: (r) => r.email ?? <span className="text-cx-faint">—</span> },
  ];

  return (
    <div>
      <ZoneHeader title="Staff" />

      <div className="mb-4">
        <Section title="Staff by role" desc={`${total.toLocaleString("en-IN")} people`} flush>
          <MeterList rows={roles.map((r) => ({ label: humanize(r.label), value: r.value }))} max={Math.max(1, ...roles.map((r) => r.value))} format={(v) => v.toLocaleString("en-IN")} labelWidth={160} />
        </Section>
      </div>

      <Section
        title={q ? `Matching “${q}”` : "All staff"}
        desc={`${(count ?? 0).toLocaleString("en-IN")} records`}
        flush
        right={<a href={`${base}/export`} className={btnGhost}>Export CSV</a>}
      >
        <div className="border-b border-cx-line px-4 py-3"><SearchForm action={base} defaultValue={q} placeholder="Search by name, employee code or email" /></div>
        <ConsoleTable bare columns={cols} rows={rows} rowKey={(r) => r.id} empty={q ? `No staff match “${q}”` : "No staff"} />
        <div className="border-t border-cx-line px-4 pb-3"><Pager page={page} pageSize={SIZE} total={count ?? 0} hrefFor={(p) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} /></div>
      </Section>
    </div>
  );
}
