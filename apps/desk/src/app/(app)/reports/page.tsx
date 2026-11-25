import { requireSetUp } from "@/lib/context";
import { todayIST, fyOf, hoursText, KIND_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, Kpi, kpiStrip } from "@/components/ui";

export const metadata = { title: "Reports" };

type T = { kind: string; status: string; category_id: number | null; created_at: string; first_response_at: string | null; resolved_at: string | null; respond_by: string | null; resolve_by: string | null };

// How the help desk is doing this financial year. The grievance figures are
// what accreditation (NAAC criterion 5, grievance redressal) asks for.
export default async function Reports() {
  const { db, org } = await requireSetUp();
  const fy = fyOf(todayIST());
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("ticket").select("kind, status, category_id, created_at, first_response_at, resolved_at, respond_by, resolve_by")
      .eq("org_id", org.id).gte("created_at", `${fy.start}T00:00:00+05:30`).lte("created_at", `${fy.end}T23:59:59+05:30`).order("id").range(from, from + 999);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  const { data: cats } = await db.from("category").select("id, name").eq("org_id", org.id);
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3600e3;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  const summary = (list: T[]) => {
    const responded = list.filter((t) => t.first_response_at);
    const resolved = list.filter((t) => t.resolved_at);
    return {
      total: list.length,
      resolved: resolved.length,
      firstReply: avg(responded.map((t) => hours(t.created_at, t.first_response_at!))),
      resolution: avg(resolved.map((t) => hours(t.created_at, t.resolved_at!))),
      onTime: resolved.length ? Math.round((100 * resolved.filter((t) => t.resolve_by && t.resolved_at! <= t.resolve_by).length) / resolved.length) : null,
    };
  };
  const all = summary(rows);
  const byKind = ["request", "complaint", "grievance"].map((k) => ({ k, ...summary(rows.filter((t) => t.kind === k)) }));
  const byCat = new Map<string, number>();
  for (const t of rows) { const n = t.category_id ? catName.get(t.category_id) ?? "Other" : "Not set"; byCat.set(n, (byCat.get(n) ?? 0) + 1); }

  return (
    <div>
      <PageHeader title="Reports" sub={`Financial year ${fy.label}`} />
      <div className={kpiStrip}>
        <Kpi label="Requests received" value={all.total} />
        <Kpi label="Resolved" value={all.resolved} />
        <Kpi label="Typical first reply" value={all.firstReply === null ? "No replies yet" : hoursText(all.firstReply)} sub="average" />
        <Kpi label="Typical resolution" value={all.resolution === null ? "None resolved yet" : hoursText(all.resolution)} sub="average" />
        <Kpi label="Resolved on time" value={all.onTime === null ? "None resolved yet" : `${all.onTime}%`} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title="By type" desc="Grievance figures serve as grievance-redressal evidence for accreditation" flush>
          {all.total ? (
            <Table head={[{ label: "Type" }, { label: "Received", right: true }, { label: "Resolved", right: true }, { label: "Typical resolution", right: true }, { label: "On time", right: true }]}>
              {byKind.map((r) => (
                <tr key={r.k}>
                  <td className={td}>{KIND_LABEL[r.k]}s</td>
                  <td className={`${td} text-right tabular-nums`}>{r.total}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.resolved}</td>
                  <td className={`${td} text-right`}>{r.resolution === null ? "" : hoursText(r.resolution)}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.onTime === null ? "" : `${r.onTime}%`}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No requests this year yet.</Empty>}
        </Section>
        <Section title="By subject" flush>
          {byCat.size ? (
            <ul className="divide-y divide-cx-line">
              {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => (
                <li key={n} className="flex justify-between px-5 py-2 text-[14px]"><span className="text-cx-text">{n}</span><span className="tabular-nums text-cx-text-2">{c}</span></li>
              ))}
            </ul>
          ) : <Empty>Nothing yet.</Empty>}
        </Section>
      </div>
    </div>
  );
}
