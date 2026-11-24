import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf, currentYear, sectionClassMaps } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip, SessionTag, ConsoleTable, type Col } from "@/components/console/table";
import { EmptyState, Section, btnGhost } from "@/components/console/ui";
import { ModuleNotice } from "@/components/console/module-notice";
import { MeterList } from "@/components/console/meter-list";
import { Icon } from "@/components/console/icons";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MODE: Record<string, string> = { upi: "UPI", bank: "Bank transfer", card: "Card", cash: "Cash", cheque: "Cheque" };
type Inv = { student_id: number; section_id: number | null; title: string; amount: number; paid_amount: number; due_date: string };

export default async function FeesZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).fees;
  const year = await currentYear(admin, s.id);

  const invoices: Inv[] = [];
  if (year) {
    for (let from = 0; ; from += 1000) {
      const { data } = await admin.from("fee_invoice").select("student_id, section_id, title, amount, paid_amount, due_date").eq("school_id", s.id).eq("academic_year_id", year.id).neq("status", "cancelled").range(from, from + 999);
      invoices.push(...((data ?? []) as Inv[]));
      if (!data || data.length < 1000) break;
    }
  }

  if (invoices.length === 0) {
    return (
      <div>
        <ZoneHeader title="Fees"><SessionTag name={year?.name} /></ZoneHeader>
        {!on && <ModuleNotice module="fees" schoolId={s.id} />}
        <EmptyState
          icon={<Icon name="fees" size={22} />}
          title="No fees billed yet"
          body={`${s.name} hasn't raised any invoices this session. The office sets up fee heads and bills students from its own portal, and the totals appear here as soon as it does.`}
          action={on ? <a href={`https://${s.slug}.${BASE}/dashboard/fees`} target="_blank" rel="noreferrer" className={btnGhost}>Open fees in the school portal <Icon name="external" size={14} /></a> : undefined}
        />
      </div>
    );
  }

  const { data: pays } = await admin.from("fee_payment").select("mode, amount").eq("school_id", s.id).eq("is_refund", false).limit(10000);
  const billed = invoices.reduce((t, i) => t + Number(i.amount), 0);
  const collected = invoices.reduce((t, i) => t + Number(i.paid_amount), 0);
  const outstanding = billed - collected;

  const terms = [...new Set(invoices.map((i) => i.title))].map((title) => {
    const list = invoices.filter((i) => i.title === title);
    const b = list.reduce((t, i) => t + Number(i.amount), 0);
    const c = list.reduce((t, i) => t + Number(i.paid_amount), 0);
    return { title, billed: b, collected: c, rate: b ? (100 * c) / b : 0, due: list.reduce((m, i) => (i.due_date < m ? i.due_date : m), list[0].due_date) };
  }).sort((a, b) => a.due.localeCompare(b.due));

  const modes = new Map<string, number>();
  for (const p of pays ?? []) modes.set(p.mode, (modes.get(p.mode) ?? 0) + Number(p.amount));
  const modeRows = [...modes.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => ({ label: MODE[m] ?? m, value: v }));

  const owing = new Map<number, { section_id: number | null; amount: number; oldest: string }>();
  for (const i of invoices) {
    const due = Number(i.amount) - Number(i.paid_amount);
    if (due <= 0) continue;
    const o = owing.get(i.student_id) ?? { section_id: i.section_id, amount: 0, oldest: i.due_date };
    o.amount += due; if (i.due_date < o.oldest) o.oldest = i.due_date;
    owing.set(i.student_id, o);
  }
  const top = [...owing.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 15);
  const [{ data: names }, maps] = await Promise.all([
    admin.from("student").select("id, full_name, admission_no").in("id", top.map(([sid]) => sid).length ? top.map(([sid]) => sid) : [0]),
    sectionClassMaps(admin, s.id),
  ]);
  const nameOf = new Map((names ?? []).map((n) => [n.id, n]));
  type Due = { id: number; name: string; adm: string; cls: string; amount: number; oldest: string };
  const dueRows: Due[] = top.map(([sid, o]) => ({ id: sid, name: nameOf.get(sid)?.full_name ?? "", adm: nameOf.get(sid)?.admission_no ?? "", cls: o.section_id ? maps.sectionLabel.get(o.section_id) ?? "" : "", amount: o.amount, oldest: o.oldest }));

  type Term = (typeof terms)[number];
  const termCols: Col<Term>[] = [
    { key: "t", label: "Term", render: (r) => <span className="font-medium text-cx-text">{r.title}</span> },
    { key: "d", label: "Due on", render: (r) => <span className="tabular-nums">{fmt(r.due)}</span> },
    { key: "b", label: "Billed", align: "right", render: (r) => inr(r.billed) },
    { key: "c", label: "Collected", align: "right", render: (r) => inr(r.collected) },
    { key: "r", label: "Collected share", align: "right", render: (r) => <span className="text-cx-text">{r.rate.toFixed(1)}%</span> },
  ];
  const dueCols: Col<Due>[] = [
    { key: "n", label: "Student", render: (r) => <div><div className="font-medium text-cx-text">{r.name}</div><div className="text-[12px] text-cx-muted">{r.adm}</div></div> },
    { key: "c", label: "Class", render: (r) => r.cls },
    { key: "o", label: "Overdue since", render: (r) => <span className="tabular-nums">{fmt(r.oldest)}</span> },
    { key: "a", label: "Outstanding", align: "right", render: (r) => <span className="font-medium text-cx-text">{inr(r.amount)}</span> },
  ];

  return (
    <div>
      <ZoneHeader title="Fees"><SessionTag name={year?.name} /></ZoneHeader>
      {!on && <ModuleNotice module="fees" schoolId={s.id} />}

      <div className={kpiStrip}>
        <Kpi label="Billed" value={inr(billed)} />
        <Kpi label="Collected" value={inr(collected)} />
        <Kpi label="Outstanding" value={inr(outstanding)} sub={`${owing.size.toLocaleString("en-IN")} students owe fees`} />
        <Kpi label="Collection rate" value={`${billed ? ((100 * collected) / billed).toFixed(1) : "0"}%`} />
      </div>

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title="Collection by term" flush>
            <ConsoleTable bare columns={termCols} rows={terms} rowKey={(r) => r.title} />
          </Section>
        </div>
        <Section title="Payment methods" desc="Amount received through each" flush>
          <MeterList rows={modeRows} max={Math.max(1, ...modeRows.map((m) => m.value))} format={inr} />
        </Section>
      </div>

      <Section title="Largest outstanding balances" desc="Students who owe the most this session" flush>
        <ConsoleTable bare columns={dueCols} rows={dueRows} rowKey={(r) => r.id} empty="Every student is paid up" />
      </Section>
    </div>
  );
}
