import { requireStaff } from "@/lib/context";
import { todayIST, fyOf, inr } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, Kpi, kpiStrip } from "@/components/ui";

export const metadata = { title: "Reports" };

// What accreditation (NAAC criterion 5) and rankings (NIRF) ask about alumni:
// how many, where they are working or studying, their contributions and the
// alumni association's activity.
export default async function Reports() {
  const { db, org } = await requireStaff();
  const today = todayIST();
  const fy = fyOf(today);
  const all: { batch_year: number | null; company: string | null; higher_studies: string | null; city: string | null; user_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("member").select("batch_year, company, higher_studies, city, user_id").eq("org_id", org.id).eq("status", "verified").order("id").range(from, from + 999);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const [gifts, events] = await Promise.all([
    db.from("donation").select("amount, member_id").eq("org_id", org.id).eq("status", "recorded").gte("donated_on", fy.start).lte("donated_on", fy.end).limit(50000),
    db.from("event").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "published").gte("starts_at", `${fy.start}T00:00:00+05:30`).lte("starts_at", `${fy.end}T23:59:59+05:30`),
  ]);
  const byBatch = new Map<number, { n: number; working: number; studying: number }>();
  for (const m of all) {
    if (!m.batch_year) continue;
    const b = byBatch.get(m.batch_year) ?? { n: 0, working: 0, studying: 0 };
    b.n++; if (m.company) b.working++; if (m.higher_studies) b.studying++;
    byBatch.set(m.batch_year, b);
  }
  const cities = new Map<string, number>();
  for (const m of all) if (m.city) cities.set(m.city.trim(), (cities.get(m.city.trim()) ?? 0) + 1);
  const raised = (gifts.data ?? []).reduce((s, g) => s + Number(g.amount), 0);
  const alumniGivers = new Set((gifts.data ?? []).filter((g) => g.member_id).map((g) => g.member_id)).size;

  return (
    <div>
      <PageHeader title="Reports" sub={`For NAAC and NIRF submissions, financial year ${fy.label}`} />
      <div className={kpiStrip}>
        <Kpi label="Verified alumni" value={all.length} sub={`${all.filter((m) => m.user_id).length} signed in`} />
        <Kpi label="Working" value={all.filter((m) => m.company).length} sub="employer recorded" />
        <Kpi label="In higher studies" value={all.filter((m) => m.higher_studies).length} />
        <Kpi label={`Contributions ${fy.label}`} value={inr(raised)} sub={`${alumniGivers} alumni gave`} />
        <Kpi label={`Events ${fy.label}`} value={events.count ?? 0} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title="By batch" flush>
          {byBatch.size ? (
            <Table head={[{ label: "Batch" }, { label: "Alumni", right: true }, { label: "Working", right: true }, { label: "Higher studies", right: true }]}>
              {[...byBatch.entries()].sort((a, b) => b[0] - a[0]).map(([y, b]) => (
                <tr key={y}><td className={td}>{y}</td><td className={`${td} text-right tabular-nums`}>{b.n}</td><td className={`${td} text-right tabular-nums`}>{b.working}</td><td className={`${td} text-right tabular-nums`}>{b.studying}</td></tr>
              ))}
            </Table>
          ) : <Empty>No batches recorded yet.</Empty>}
        </Section>
        <Section title="Where alumni live" flush>
          {cities.size ? (
            <ul className="divide-y divide-cx-line">
              {[...cities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, n]) => (
                <li key={c} className="flex justify-between px-5 py-2 text-[14px]"><span className="text-cx-text">{c}</span><span className="tabular-nums text-cx-text-2">{n}</span></li>
              ))}
            </ul>
          ) : <Empty>No cities recorded yet.</Empty>}
        </Section>
      </div>
    </div>
  );
}
