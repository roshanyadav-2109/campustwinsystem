import Link from "next/link";
import { requireBooks } from "@/lib/context";
import { balances } from "@/lib/data";
import { todayIST, fyOf, amt, inr, fmtDate, KIND_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputBase, btnGhost, linkCls, Status } from "@/components/ui";

export const metadata = { title: "Reports" };

const TABS = [
  ["tb", "Trial balance"], ["pl", "Profit and loss"], ["bs", "Balance sheet"], ["ledger", "Account ledger"], ["gst", "GST summary"],
] as const;
type Tab = (typeof TABS)[number][0];
const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function Reports({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string; account?: string }> }) {
  const { db, org } = await requireBooks();
  const sp = await searchParams;
  const tab: Tab = (TABS.map((t) => t[0]) as string[]).includes(sp.r ?? "") ? (sp.r as Tab) : "tb";
  const today = todayIST();
  const fy = fyOf(today);
  const to = isDay(sp.to) ? sp.to! : today;
  const from = isDay(sp.from) && sp.from! <= to ? sp.from! : fyOf(to).start;
  const accountId = Number(sp.account) || null;
  const q = (extra: Record<string, string>) => `/reports?${new URLSearchParams({ r: tab, from, to, ...(accountId ? { account: String(accountId) } : {}), ...extra })}`;

  const tb = await balances(db, org.id, from, to);
  const { data: accts } = await db.from("account").select("id, code, name").eq("org_id", org.id).eq("is_group", false).order("code");

  let body: React.ReactNode = null;
  if (tab === "tb") {
    const rows = tb.filter((r) => r.opening || r.debit || r.credit);
    const sum = (k: "debit" | "credit") => rows.reduce((s, r) => s + r[k], 0);
    const dr = rows.reduce((s, r) => s + Math.max(r.closing, 0), 0), cr = rows.reduce((s, r) => s + Math.max(-r.closing, 0), 0);
    body = rows.length ? (
      <Table head={[{ label: "Account" }, { label: "Opening", right: true }, { label: "Debit", right: true }, { label: "Credit", right: true }, { label: "Closing Dr", right: true }, { label: "Closing Cr", right: true }]}>
        {rows.map((r) => (
          <tr key={r.account_id}>
            <td className={td}><Link href={q({ r: "ledger", account: String(r.account_id) })} className="text-cx-text hover:underline">{r.name}</Link> <span className="text-cx-faint">{r.code}</span></td>
            <td className={`${td} text-right tabular-nums`}>{r.opening ? `${amt(Math.abs(r.opening))} ${r.opening > 0 ? "Dr" : "Cr"}` : ""}</td>
            <td className={`${td} text-right tabular-nums`}>{amt(r.debit, true)}</td>
            <td className={`${td} text-right tabular-nums`}>{amt(r.credit, true)}</td>
            <td className={`${td} text-right tabular-nums`}>{r.closing > 0 ? amt(r.closing) : ""}</td>
            <td className={`${td} text-right tabular-nums`}>{r.closing < 0 ? amt(-r.closing) : ""}</td>
          </tr>
        ))}
        <tr className="font-semibold text-cx-text">
          <td className={td}>Total</td><td className={td} />
          <td className={`${td} text-right tabular-nums`}>{amt(sum("debit"))}</td><td className={`${td} text-right tabular-nums`}>{amt(sum("credit"))}</td>
          <td className={`${td} text-right tabular-nums`}>{amt(dr)}</td><td className={`${td} text-right tabular-nums`}>{amt(cr)}</td>
        </tr>
      </Table>
    ) : <Empty>No entries in this period.</Empty>;
  }

  if (tab === "pl") {
    const inc = tb.filter((r) => r.root_type === "income" && (r.debit || r.credit)).map((r) => ({ ...r, v: r.credit - r.debit }));
    const exp = tb.filter((r) => r.root_type === "expense" && (r.debit || r.credit)).map((r) => ({ ...r, v: r.debit - r.credit }));
    const ti = inc.reduce((s, r) => s + r.v, 0), te = exp.reduce((s, r) => s + r.v, 0);
    const block = (title: string, list: typeof inc, total: number) => (
      <div>
        <p className="border-b border-cx-line px-5 py-2.5 text-[13px] font-semibold text-cx-text">{title}</p>
        <ul className="divide-y divide-cx-line">
          {list.map((r) => <li key={r.account_id} className="flex justify-between px-5 py-2 text-[14px]"><Link href={q({ r: "ledger", account: String(r.account_id) })} className="text-cx-text-2 hover:underline">{r.name}</Link><span className="tabular-nums">{amt(r.v)}</span></li>)}
          <li className="flex justify-between px-5 py-2 text-[14px] font-semibold"><span>Total {title.toLowerCase()}</span><span className="tabular-nums">{amt(total)}</span></li>
        </ul>
      </div>
    );
    body = (
      <div>
        {block("Income", inc, ti)}
        {block("Expenses", exp, te)}
        <p className="flex justify-between border-t border-cx-line px-5 py-3 text-[16px] font-semibold"><span>{ti - te >= 0 ? "Surplus" : "Deficit"}</span><span className="tabular-nums">{inr(Math.abs(ti - te))}</span></p>
      </div>
    );
  }

  if (tab === "bs") {
    // As on `to`: balance sheet accounts are cumulative; this year's surplus is
    // added to equity together with everything carried from earlier years.
    const yr = await balances(db, org.id, fyOf(to).start, to);
    const { data: carried } = await db.rpc("retained_until", { p_org: org.id, p_date: to });
    const thisYear = -yr.filter((r) => r.root_type === "income" || r.root_type === "expense").reduce((s, r) => s + r.closing, 0);
    const side = (root: string, sign: number) => yr.filter((r) => r.root_type === root && r.closing).map((r) => ({ ...r, v: r.closing * sign }));
    const assets = side("asset", 1), liab = side("liability", -1), eq = side("equity", -1);
    const ta = assets.reduce((s, r) => s + r.v, 0);
    const tl = liab.reduce((s, r) => s + r.v, 0);
    const te = eq.reduce((s, r) => s + r.v, 0) + Number(carried ?? 0) + thisYear;
    const ok = Math.abs(ta - tl - te) < 0.005;
    const list = (rows: typeof assets) => rows.map((r) => <li key={r.account_id} className="flex justify-between px-5 py-2 text-[14px]"><span className="text-cx-text-2">{r.name}</span><span className="tabular-nums">{amt(r.v)}</span></li>);
    body = (
      <div className="grid md:grid-cols-2 md:divide-x divide-cx-line">
        <div>
          <p className="border-b border-cx-line px-5 py-2.5 text-[13px] font-semibold">What you own</p>
          <ul className="divide-y divide-cx-line">{list(assets)}<li className="flex justify-between px-5 py-2.5 font-semibold"><span>Total assets</span><span className="tabular-nums">{amt(ta)}</span></li></ul>
        </div>
        <div>
          <p className="border-b border-cx-line px-5 py-2.5 text-[13px] font-semibold">What you owe and your funds</p>
          <ul className="divide-y divide-cx-line">
            {list(liab)}
            <li className="flex justify-between px-5 py-2 text-[14px] font-medium"><span>Total liabilities</span><span className="tabular-nums">{amt(tl)}</span></li>
            {list(eq)}
            {Number(carried ?? 0) !== 0 && <li className="flex justify-between px-5 py-2 text-[14px]"><span className="text-cx-text-2">Surplus from earlier years</span><span className="tabular-nums">{amt(carried)}</span></li>}
            <li className="flex justify-between px-5 py-2 text-[14px]"><span className="text-cx-text-2">{thisYear >= 0 ? "Surplus" : "Deficit"} this year</span><span className="tabular-nums">{amt(thisYear)}</span></li>
            <li className="flex justify-between px-5 py-2.5 font-semibold"><span>Total</span><span className="tabular-nums">{amt(tl + te)}</span></li>
          </ul>
        </div>
        <p className="border-t border-cx-line px-5 py-3 md:col-span-2"><Status tone={ok ? "ok" : "bad"}>{ok ? "Balanced: assets equal liabilities plus funds" : `Out of balance by ${amt(ta - tl - te)}`}</Status></p>
      </div>
    );
  }

  if (tab === "ledger") {
    if (!accountId) body = <Empty>Choose an account above.</Empty>;
    else {
      const row = tb.find((r) => r.account_id === accountId);
      const { data: gl } = await db.from("gl_entry").select("id, date, debit, credit, is_reversal, voucher_id, voucher:voucher!gl_entry_org_id_voucher_id_fkey(kind, number, narration), party:party!gl_entry_org_id_party_id_fkey(name)")
        .eq("org_id", org.id).eq("account_id", accountId).gte("date", from).lte("date", to).order("date").order("id").limit(5000);
      const opening = row?.opening ?? 0;
      const lines = (gl ?? []).reduce<(NonNullable<typeof gl>[number] & { run: number })[]>((acc, g) => {
        const prev = acc.length ? acc[acc.length - 1].run : opening;
        acc.push({ ...g, run: Math.round((prev + Number(g.debit) - Number(g.credit)) * 100) / 100 });
        return acc;
      }, []);
      body = (
        <Table head={[{ label: "Date" }, { label: "Document" }, { label: "Debit", right: true }, { label: "Credit", right: true }, { label: "Balance", right: true }]}>
          <tr><td className={td}>{fmtDate(from)}</td><td className={td}>Opening balance</td><td className={td} /><td className={td} /><td className={`${td} text-right tabular-nums`}>{amt(Math.abs(opening))} {opening >= 0 ? "Dr" : "Cr"}</td></tr>
          {lines.map((g) => {
            const run = g.run;
            const v = g.voucher as unknown as { kind: string; number: string; narration: string | null };
            return (
              <tr key={g.id} className={g.is_reversal ? "text-cx-muted" : ""}>
                <td className={td}>{fmtDate(g.date)}</td>
                <td className={td}><Link href={`/v/${g.voucher_id}`} className={linkCls}>{KIND_LABEL[v?.kind]} {v?.number}</Link>
                  <div className="text-[12px] text-cx-muted">{[(g.party as unknown as { name: string } | null)?.name, g.is_reversal ? "cancelled" : v?.narration].filter(Boolean).join(", ")}</div></td>
                <td className={`${td} text-right tabular-nums`}>{amt(g.debit, true)}</td>
                <td className={`${td} text-right tabular-nums`}>{amt(g.credit, true)}</td>
                <td className={`${td} text-right tabular-nums`}>{amt(Math.abs(run))} {run >= 0 ? "Dr" : "Cr"}</td>
              </tr>
            );
          })}
        </Table>
      );
    }
  }

  if (tab === "gst") {
    const { data: g } = await db.rpc("gst_summary", { p_org: org.id, p_from: from, p_to: to });
    const rows = (g ?? []).map((r) => ({ ...r, taxable: Number(r.taxable), cgst: Number(r.cgst), sgst: Number(r.sgst), igst: Number(r.igst), tax_rate: Number(r.tax_rate) }));
    const tax = (side: string) => rows.filter((r) => r.side === side).reduce((s, r) => s + r.cgst + r.sgst + r.igst, 0);
    body = rows.length ? (
      <>
        <Table head={[{ label: "" }, { label: "Rate", right: true }, { label: "Taxable value", right: true }, { label: "CGST", right: true }, { label: "SGST", right: true }, { label: "IGST", right: true }]}>
          {rows.map((r) => (
            <tr key={r.side + r.tax_rate}>
              <td className={td}>{r.side === "output" ? "On sales (output)" : "On purchases (input)"}</td>
              <td className={`${td} text-right tabular-nums`}>{r.tax_rate}%</td>
              <td className={`${td} text-right tabular-nums`}>{amt(r.taxable)}</td>
              <td className={`${td} text-right tabular-nums`}>{amt(r.cgst, true)}</td>
              <td className={`${td} text-right tabular-nums`}>{amt(r.sgst, true)}</td>
              <td className={`${td} text-right tabular-nums`}>{amt(r.igst, true)}</td>
            </tr>
          ))}
        </Table>
        <p className="flex justify-between border-t border-cx-line px-5 py-3 text-[15px] font-semibold">
          <span>{tax("output") - tax("input") >= 0 ? "GST to pay (output less input credit)" : "Input credit carried forward"}</span>
          <span className="tabular-nums">{inr(Math.abs(tax("output") - tax("input")))}</span>
        </p>
      </>
    ) : <Empty>No GST in this period.</Empty>;
  }

  return (
    <div>
      <PageHeader title="Reports" sub={tab === "bs" ? `As on ${fmtDate(to)}` : `${fmtDate(from)} to ${fmtDate(to)}`} />
      <div className="mb-3 flex flex-wrap gap-1 border-b border-cx-line">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/reports?${new URLSearchParams({ r: k, from, to, ...(accountId ? { account: String(accountId) } : {}) })}`}
            className={`-mb-px border-b-2 px-3 py-2 text-[13.5px] ${tab === k ? "border-cx-text font-medium text-cx-text" : "border-transparent text-cx-text-2 hover:text-cx-text"}`}>{label}</Link>
        ))}
      </div>
      <form className="mb-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="r" value={tab} />
        {tab !== "bs" && <><label htmlFor="from" className="text-[13px] text-cx-muted">From</label><input id="from" name="from" type="date" defaultValue={from} className={`${inputBase} w-auto`} /></>}
        <label htmlFor="to" className="text-[13px] text-cx-muted">{tab === "bs" ? "As on" : "To"}</label>
        <input id="to" name="to" type="date" defaultValue={to} className={`${inputBase} w-auto`} />
        {tab === "ledger" && (
          <>
            <label htmlFor="account" className="sr-only">Account</label>
            <select id="account" name="account" defaultValue={accountId ?? ""} className={`${inputBase} w-auto`}>
              <option value="">Choose an account</option>
              {(accts ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </>
        )}
        <button className={btnGhost}>Show</button>
        <Link href={`/reports?r=${tab}&from=${fy.start}&to=${today}`} className="text-[13px] text-cx-link hover:underline">This financial year</Link>
      </form>
      <Section flush>{body}</Section>
    </div>
  );
}
