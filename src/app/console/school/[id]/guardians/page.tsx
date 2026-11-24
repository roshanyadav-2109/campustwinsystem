import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool } from "@/lib/console/tenant";
import { ConsoleTable, SearchForm, Pager, Avatar, Pill, ZoneHeader, type Col } from "@/components/console/table";

const SIZE = 50;
type Row = { id: number; full_name: string; relation: string | null; phone: string | null; email: string | null };

export default async function GuardiansZone({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const safe = q.replace(/[,()\\%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const base = `/console/school/${s.id}/guardians`;

  let query = admin.from("guardian").select("id, full_name, relation, phone, email", { count: "exact" }).eq("school_id", s.id);
  if (safe) query = query.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`);
  const { data, count } = await query.order("full_name").range((page - 1) * SIZE, page * SIZE - 1);
  const rows = (data ?? []) as Row[];

  const cols: Col<Row>[] = [
    { key: "name", label: "Guardian", render: (r) => (
      <div className="flex items-center gap-2.5"><Avatar name={r.full_name} /><span className="truncate font-medium text-ink-900">{r.full_name}</span></div>
    ) },
    { key: "relation", label: "Relation", render: (r) => r.relation ? <Pill>{r.relation}</Pill> : <span className="text-ink-400">—</span> },
    { key: "phone", label: "Phone", render: (r) => <span className="text-ink-600">{r.phone ?? "—"}</span> },
    { key: "email", label: "Email", render: (r) => <span className="text-ink-600">{r.email ?? "—"}</span> },
  ];

  return (
    <div>
      <ZoneHeader title="Guardians" sub={`${(count ?? 0).toLocaleString()} parents / guardians`} />
      <div className="mb-3"><SearchForm action={base} defaultValue={q} placeholder="Search by name, phone or email…" /></div>
      <ConsoleTable columns={cols} rows={rows} rowKey={(r) => r.id} empty={q ? `No guardians match “${q}”.` : "No guardians."} />
      <Pager page={page} pageSize={SIZE} total={count ?? 0} hrefFor={(p) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} />
    </div>
  );
}
