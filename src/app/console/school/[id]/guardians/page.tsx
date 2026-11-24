import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, guardianRelations, humanize } from "@/lib/console/tenant";
import { ConsoleTable, SearchForm, Pager, Avatar, Kpi, ZoneHeader, kpiStrip, type Col } from "@/components/console/table";
import { Section } from "@/components/console/ui";
import { MeterList } from "@/components/console/meter-list";

const SIZE = 25;
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
  const [{ data, count }, relations, { count: total }, { count: withEmail }, { count: withPhone }] = await Promise.all([
    query.order("full_name").range((page - 1) * SIZE, page * SIZE - 1),
    guardianRelations(s.id),
    admin.from("guardian").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("guardian").select("*", { count: "exact", head: true }).eq("school_id", s.id).not("email", "is", null),
    admin.from("guardian").select("*", { count: "exact", head: true }).eq("school_id", s.id).not("phone", "is", null),
  ]);
  const rows = (data ?? []) as Row[];
  // Names are often stored as "Surname (Father)"; the relation already has a column.
  const plain = (r: Row) => {
    const suffix = r.relation ? ` (${r.relation})`.toLowerCase() : "";
    return suffix && r.full_name.toLowerCase().endsWith(suffix) ? r.full_name.slice(0, -suffix.length) : r.full_name;
  };
  const anyEmail = rows.some((r) => r.email);
  const pct = (n: number | null) => (total ? `${Math.round(((n ?? 0) / total) * 100)}%` : "0%");

  const cols: Col<Row>[] = [
    { key: "name", label: "Guardian", render: (r) => (
      <div className="flex items-center gap-2.5 py-1"><Avatar name={plain(r)} /><span className="truncate font-medium text-cx-text">{plain(r)}</span></div>
    ) },
    { key: "relation", label: "Relation", render: (r) => (r.relation ? humanize(r.relation.toLowerCase()) : <span className="text-cx-muted">Not recorded</span>) },
    { key: "phone", label: "Phone", render: (r) => r.phone ? <span className="tabular-nums">{r.phone}</span> : <span className="text-cx-muted">Not recorded</span> },
    ...(anyEmail ? [{ key: "email", label: "Email for sign-in", render: (r: Row) => r.email ?? <span className="text-cx-muted">Not recorded</span> }] : []),
  ];

  return (
    <div>
      <ZoneHeader title="Guardians" />

      <div className={kpiStrip}>
        <Kpi label="Parents and guardians" value={total ?? 0} />
        <Kpi label="Can sign in with Google" value={pct(withEmail)} sub={`${(withEmail ?? 0).toLocaleString("en-IN")} have an email on record`} />
        <Kpi label="Reachable by phone" value={pct(withPhone)} sub={`${(withPhone ?? 0).toLocaleString("en-IN")} have a phone number`} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title={q ? `Guardians matching ${q}` : "All guardians"} flush>
            <div className="border-b border-cx-line px-5 py-3"><SearchForm action={base} defaultValue={q} placeholder="Search by name, phone or email" /></div>
            <ConsoleTable bare columns={cols} rows={rows} rowKey={(r) => r.id} empty={q ? `No guardians match ${q}` : "No guardians"} />
            <div className="border-t border-cx-line px-5 pb-3"><Pager page={page} pageSize={SIZE} total={count ?? 0} hrefFor={(p) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} /></div>
          </Section>
        </div>
        <div className="xl:sticky xl:top-16">
          <Section title="By relation" flush>
            <MeterList rows={relations.map((r) => ({ label: humanize(r.label), value: r.value }))} max={Math.max(1, total ?? 0)} format={(v) => v.toLocaleString("en-IN")} labelWidth={110} />
          </Section>
        </div>
      </div>
    </div>
  );
}
