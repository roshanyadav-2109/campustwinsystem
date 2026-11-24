import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf, currentYear } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip, SessionTag, ConsoleTable, Pill, type Col } from "@/components/console/table";
import { EmptyState, Section, btnGhost } from "@/components/console/ui";
import { ModuleNotice } from "@/components/console/module-notice";
import { MeterList } from "@/components/console/meter-list";
import { Icon } from "@/components/console/icons";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
// The app's own enquiry workflow, in order.
const STAGES: [string, string][] = [["new", "New"], ["contacted", "Contacted"], ["visit_scheduled", "Visit scheduled"], ["applied", "Applied"], ["admitted", "Admitted"], ["not_interested", "Not interested"]];
const STAGE = Object.fromEntries(STAGES);
const SOURCE: Record<string, string> = { walk_in: "Walk-in", phone: "Phone", online: "Online", referral: "Referral", other: "Other" };
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
type Enq = { id: number; child_name: string; class_id: number; guardian_name: string; phone: string; source: string; status: string; next_follow_up: string | null };

export default async function AdmissionsZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).admissions;
  const year = await currentYear(admin, s.id);
  const [{ data }, { data: classes }] = await Promise.all([
    admin.from("admission_enquiry").select("id, child_name, class_id, guardian_name, phone, source, status, next_follow_up").eq("school_id", s.id).order("created_at", { ascending: false }).limit(2000),
    admin.from("class").select("id, name").eq("school_id", s.id),
  ]);
  const rows = (data ?? []) as Enq[];
  const className = new Map((classes ?? []).map((c) => [c.id, c.name]));

  if (rows.length === 0) {
    return (
      <div>
        <ZoneHeader title="Admissions"><SessionTag name={year?.name} /></ZoneHeader>
        {!on && <ModuleNotice module="admissions" schoolId={s.id} />}
        <EmptyState
          icon={<Icon name="admissions" size={22} />}
          title="No admission enquiries yet"
          body={`${s.name} hasn't logged any enquiries. Each enquiry the office records, and every follow-up on it, shows here.`}
          action={on ? <a href={`https://${s.slug}.${BASE}/dashboard/admissions`} target="_blank" rel="noreferrer" className={btnGhost}>Open admissions in the school portal <Icon name="external" size={14} /></a> : undefined}
        />
      </div>
    );
  }

  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const closed = count("admitted") + count("not_interested");
  const open = rows.length - closed;
  const decided = count("admitted") + count("not_interested");
  const sources = Object.entries(rows.reduce<Record<string, number>>((m, r) => ((m[r.source] = (m[r.source] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: SOURCE[k] ?? k, value: v }));
  const followUps = rows.filter((r) => r.next_follow_up && !["admitted", "not_interested"].includes(r.status)).sort((a, b) => (a.next_follow_up ?? "").localeCompare(b.next_follow_up ?? "")).slice(0, 12);

  const cols: Col<Enq>[] = [
    { key: "d", label: "Follow up on", render: (r) => <span className="tabular-nums font-medium text-cx-text">{fmt(r.next_follow_up!)}</span> },
    { key: "c", label: "Child", render: (r) => <div><div className="font-medium text-cx-text">{r.child_name}</div><div className="text-[12px] text-cx-muted">For {className.get(r.class_id) ?? "a class"}</div></div> },
    { key: "g", label: "Parent", render: (r) => <div><div>{r.guardian_name}</div><div className="text-[12px] tabular-nums text-cx-muted">{r.phone}</div></div> },
    { key: "s", label: "Stage", render: (r) => <Pill tone={r.status === "applied" ? "green" : "slate"}>{STAGE[r.status] ?? r.status}</Pill> },
  ];

  return (
    <div>
      <ZoneHeader title="Admissions"><SessionTag name={year?.name} /></ZoneHeader>
      {!on && <ModuleNotice module="admissions" schoolId={s.id} />}

      <div className={kpiStrip}>
        <Kpi label="Enquiries" value={rows.length} />
        <Kpi label="Still open" value={open} />
        <Kpi label="Admitted" value={count("admitted")} />
        <Kpi label="Conversion" value={decided ? `${Math.round((100 * count("admitted")) / decided)}%` : "No decisions yet"} sub="of enquiries that reached a decision" />
      </div>

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-2">
        <Section title="Pipeline" desc="Where each enquiry stands" flush>
          <MeterList rows={STAGES.map(([k, label]) => ({ label, value: count(k) }))} max={Math.max(1, ...STAGES.map(([k]) => count(k)))} format={(v) => String(v)} />
        </Section>
        <Section title="Where enquiries come from" flush>
          <MeterList rows={sources} max={Math.max(1, ...sources.map((x) => x.value))} format={(v) => String(v)} />
        </Section>
      </div>

      <Section title="Follow-ups due" desc="Open enquiries, soonest first" flush>
        <ConsoleTable bare columns={cols} rows={followUps} rowKey={(r) => r.id} empty="No follow-ups scheduled" />
      </Section>
    </div>
  );
}
