import Link from "next/link";
import { requireBooks, requireWriter } from "@/lib/context";
import { formChoices, openDocs, type Kind } from "@/lib/data";
import { todayIST, fmtDate, amt, KIND_PATH } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputBase, btnPrimary, btnGhost, linkCls, Status } from "@/components/ui";
import { VoucherForm } from "@/components/voucher-form";
import { saveDraft } from "@/app/(app)/actions";

const TITLE: Record<Kind, { list: string; one: string; sub: string }> = {
  sales_invoice: { list: "Invoices", one: "invoice", sub: "Money you are owed" },
  purchase_bill: { list: "Bills", one: "bill", sub: "Money you owe vendors" },
  receipt: { list: "Receipts", one: "receipt", sub: "Money received" },
  payment: { list: "Payments", one: "payment", sub: "Money paid out" },
  journal: { list: "Journal entries", one: "journal entry", sub: "Adjustments, opening balances, salaries and transfers" },
};
const PAGE = 50;

export async function VoucherList({ kind, searchParams }: { kind: Kind; searchParams: Promise<{ status?: string; q?: string; page?: string; show?: string }> }) {
  const { db, org, canWrite } = await requireBooks();
  const sp = await searchParams;
  const status = ["draft", "posted", "cancelled"].includes(sp.status ?? "") ? sp.status! : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().replace(/[%_,()\\"*:]/g, " ").trim().slice(0, 60);
  const today = todayIST();
  const overdueOnly = sp.show === "overdue" && kind === "sales_invoice";

  let query = db.from("voucher").select("id, number, date, due_date, total, amount, status, reference, party:party!voucher_org_id_party_id_fkey(name)", { count: "exact" })
    .eq("org_id", org.id).eq("kind", kind);
  if (status !== "all") query = query.eq("status", status);
  if (q) query = query.or(`number.ilike.%${q}%,reference.ilike.%${q}%`);
  const open = kind === "sales_invoice" || kind === "purchase_bill" ? await openDocs(db, org.id, kind) : [];
  const due = new Map(open.map((d) => [d.id, d.due]));
  if (overdueOnly) query = query.in("id", open.filter((d) => d.due_date && d.due_date < today).map((d) => d.id).concat([-1]));
  const { data: rows, count } = await query.order("date", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const t = TITLE[kind];
  const base = KIND_PATH[kind];
  const total = count ?? 0;
  const link = (p: number) => `${base}?${new URLSearchParams({ ...(status !== "all" && { status }), ...(q && { q }), page: String(p) })}`;

  return (
    <div>
      <PageHeader title={overdueOnly ? "Overdue invoices" : t.list} sub={t.sub}>
        {canWrite && <Link href={`${base}/new`} className={btnPrimary}>New {t.one}</Link>}
      </PageHeader>
      <form className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="sr-only">Search</label>
        <input id="q" name="q" defaultValue={q} placeholder="Number or reference" className={`${inputBase} w-56`} />
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className={`${inputBase} w-auto`}>
          <option value="all">All</option><option value="draft">Drafts</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option>
        </select>
        <button className={btnGhost}>Show</button>
      </form>
      <Section flush>
        {rows?.length ? (
          <Table head={[{ label: "Number" }, { label: kind === "journal" ? "Note" : "With" }, { label: "Date" }, ...(due.size || kind === "sales_invoice" || kind === "purchase_bill" ? [{ label: "Still due", right: true }] : []), { label: "Amount", right: true }]}>
            {rows.map((v) => {
              const left = due.get(v.id);
              const late = left && v.due_date && v.due_date < today;
              return (
                <tr key={v.id}>
                  <td className={td}>
                    <Link href={`/v/${v.id}`} className={linkCls}>{v.number ?? "Draft"}</Link>
                    {v.status === "cancelled" && <span className="ml-2 text-[12px] text-cx-muted">cancelled</span>}
                  </td>
                  <td className={td}>{(v.party as unknown as { name: string } | null)?.name ?? v.reference ?? ""}</td>
                  <td className={td}>{fmtDate(v.date)}{late && <div><Status tone="warn">due {fmtDate(v.due_date)}</Status></div>}</td>
                  {(kind === "sales_invoice" || kind === "purchase_bill") && <td className={`${td} text-right tabular-nums`}>{left ? amt(left) : v.status === "posted" ? "Paid" : ""}</td>}
                  <td className={`${td} text-right tabular-nums`}>{v.status === "draft" && kind !== "receipt" && kind !== "payment" ? "" : amt(v.total ?? v.amount)}</td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>{q || status !== "all" || overdueOnly ? "Nothing matches." : `No ${t.list.toLowerCase()} yet.`}</Empty>}
        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-cx-line px-5 py-2.5 text-[13px] text-cx-muted">
            <span>{(page - 1) * PAGE + 1} to {Math.min(page * PAGE, total)} of {total}</span>
            <span className="flex gap-2">
              {page > 1 && <Link href={link(page - 1)} className={btnGhost}>Previous</Link>}
              {page * PAGE < total && <Link href={link(page + 1)} className={btnGhost}>Next</Link>}
            </span>
          </div>
        )}
      </Section>
    </div>
  );
}

export async function NewVoucher({ kind, searchParams }: { kind: Kind; searchParams?: Promise<{ party?: string }> }) {
  const { db, org } = await requireWriter();
  const choices = await formChoices(db, org.id, kind);
  const party = Number((await searchParams)?.party) || null;
  const t = TITLE[kind];
  const missing = (kind === "receipt" || kind === "payment") && !choices.cashAccounts.length;
  return (
    <div>
      <PageHeader title={`New ${t.one}`} sub={t.sub} />
      {missing ? <Section><p className="text-[14px] text-cx-text-2">Add a bank or cash account in the chart of accounts first.</p></Section> : (
        !choices.parties.length && kind !== "journal" ? (
          <Section><p className="text-[14px] text-cx-text-2">Add a {kind === "sales_invoice" || kind === "receipt" ? "customer" : "vendor"} first, under <Link href="/parties" className={linkCls}>Customers and vendors</Link>.</p></Section>
        ) : (
          <Section>
            <VoucherForm kind={kind} action={saveDraft} initial={{ date: todayIST(), party_id: party }} canPost {...choices} />
          </Section>
        )
      )}
    </div>
  );
}
