import Link from "next/link";
import { getCtx } from "@/lib/context";
import { balances, openDocs } from "@/lib/data";
import { todayIST, fyOf, inr, amt, fmtDate, KIND_LABEL, KIND_PATH } from "@/lib/format";
import { PageHeader, Section, Kpi, kpiStrip, Empty, Table, td, btnPrimary, btnGhost, linkCls, Status } from "@/components/ui";

export const metadata = { title: "Home" };

export default async function Home() {
  const { db, org, setUp, isAdmin, canWrite } = await getCtx();
  if (!setUp) {
    return (
      <div>
        <PageHeader title="Welcome to Eternity Finance" sub={org.name} />
        <Section>
          <p className="text-[14px] leading-6 text-cx-text-2">
            {isAdmin
              ? "Set up the books once: choose your state and GST number, and a ready chart of accounts for Indian institutions and businesses is created. You can change and add accounts afterwards."
              : "The books for this organisation have not been set up yet. Ask your finance admin to set them up."}
          </p>
          {isAdmin && <Link href="/setup" className={`${btnPrimary} mt-4`}>Set up the books</Link>}
        </Section>
      </div>
    );
  }

  const today = todayIST();
  const fy = fyOf(today);
  const [tb, receivable, payable, recent, drafts] = await Promise.all([
    balances(db, org.id, fy.start, today),
    openDocs(db, org.id, "sales_invoice"),
    openDocs(db, org.id, "purchase_bill"),
    db.from("voucher").select("id, kind, number, date, total, amount, status, party:party!voucher_org_id_party_id_fkey(name)").eq("org_id", org.id).neq("status", "draft").order("posted_at", { ascending: false, nullsFirst: false }).limit(8),
    db.from("voucher").select("kind").eq("org_id", org.id).eq("status", "draft").limit(500),
  ]);
  const cash = tb.filter((r) => r.account_type === "bank" || r.account_type === "cash");
  const cashTotal = cash.reduce((s, r) => s + r.closing, 0);
  const income = -tb.filter((r) => r.root_type === "income").reduce((s, r) => s + r.closing, 0);
  const expense = tb.filter((r) => r.root_type === "expense").reduce((s, r) => s + r.closing, 0);
  const owedToUs = receivable.reduce((s, d) => s + d.due, 0);
  const weOwe = payable.reduce((s, d) => s + d.due, 0);
  const overdue = receivable.filter((d) => d.due_date && d.due_date < today);
  // Drafts link to the list holding most of them.
  const draftKinds = new Map<string, number>();
  for (const d of drafts.data ?? []) draftKinds.set(d.kind, (draftKinds.get(d.kind) ?? 0) + 1);
  const draftCount = drafts.data?.length ?? 0;
  const draftPath = KIND_PATH[[...draftKinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "journal"];

  return (
    <div>
      <PageHeader title="Home" sub={`Financial year ${fy.label}`}>
        {canWrite && <Link href="/sales/new" className={btnPrimary}>New invoice</Link>}
        {canWrite && <Link href="/receipts/new" className={btnGhost}>Record a receipt</Link>}
      </PageHeader>

      <div className={kpiStrip}>
        <Kpi label="Cash and bank" value={inr(cashTotal)} />
        <Kpi label="Owed to you" value={inr(owedToUs)} sub={overdue.length ? `${overdue.length} overdue` : `${receivable.length} open invoices`} />
        <Kpi label="You owe" value={inr(weOwe)} sub={`${payable.length} open bills`} />
        <Kpi label={income - expense >= 0 ? "Surplus this year" : "Deficit this year"} value={inr(Math.abs(income - expense))} sub={`income ${inr(income)}`} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Recent activity" right={draftCount ? <Link href={`${draftPath}?status=draft`} className={linkCls}>{draftCount} draft{draftCount === 1 ? "" : "s"}</Link> : undefined} flush>
          {recent.data?.length ? (
            <Table head={[{ label: "Number" }, { label: "Type" }, { label: "With" }, { label: "Date" }, { label: "Amount", right: true }]}>
              {recent.data.map((v) => (
                <tr key={v.id}>
                  <td className={td}><Link href={`/v/${v.id}`} className={linkCls}>{v.number}</Link>{v.status === "cancelled" && <span className="ml-2 text-[12px] text-cx-muted">cancelled</span>}</td>
                  <td className={td}>{KIND_LABEL[v.kind]}</td>
                  <td className={td}>{(v.party as unknown as { name: string } | null)?.name ?? ""}</td>
                  <td className={td}>{fmtDate(v.date)}</td>
                  <td className={`${td} text-right tabular-nums`}>{amt(v.total ?? v.amount)}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>Nothing posted yet. Start with an invoice, a bill or a journal entry.</Empty>}
        </Section>

        <Section title="Cash and bank" flush>
          {cash.length ? (
            <ul className="divide-y divide-cx-line">
              {cash.map((r) => (
                <li key={r.account_id} className="flex items-center justify-between px-5 py-2.5 text-[14px]">
                  <Link href={`/reports?r=ledger&account=${r.account_id}`} className="text-cx-text hover:underline">{r.name}</Link>
                  <span className="tabular-nums text-cx-text-2">{amt(r.closing)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No bank or cash accounts.</Empty>}
          {overdue.length > 0 && (
            <div className="border-t border-cx-line px-5 py-3">
              <Status tone="warn">{overdue.length} invoice{overdue.length === 1 ? " is" : "s are"} past due</Status>
              <div className="mt-1"><Link href="/sales?show=overdue" className={linkCls}>See overdue invoices</Link></div>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
