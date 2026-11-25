import Link from "next/link";
import { requireBooks } from "@/lib/context";
import { balances } from "@/lib/data";
import { todayIST, fyOf, amt, ROOT_LABEL } from "@/lib/format";
import { PageHeader, Section, inputCls, labelCls, btnPrimary, btnQuiet, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { addAccount, toggleAccount } from "../actions";

export const metadata = { title: "Chart of accounts" };

type Acc = { id: number; code: string; name: string; root_type: string; account_type: string | null; parent_id: number | null; is_group: boolean; active: boolean };
const TYPE_LABEL: Record<string, string> = { bank: "Bank", cash: "Cash", receivable: "Receivable", payable: "Payable", tax: "Tax", fixed_asset: "Fixed asset", round_off: "Round off" };

export default async function Accounts() {
  const { db, org, canWrite } = await requireBooks();
  const today = todayIST();
  const fy = fyOf(today);
  const [{ data }, tb] = await Promise.all([
    db.from("account").select("id, code, name, root_type, account_type, parent_id, is_group, active").eq("org_id", org.id).order("code"),
    balances(db, org.id, fy.start, today),
  ]);
  const accounts = (data ?? []) as Acc[];
  const bal = new Map(tb.map((r) => [r.account_id, r.closing]));
  const kids = new Map<number | null, Acc[]>();
  for (const a of accounts) kids.set(a.parent_id, [...(kids.get(a.parent_id) ?? []), a]);
  // Group totals roll up their children; credit-side types show as positive.
  const total = (a: Acc): number => (a.is_group ? (kids.get(a.id) ?? []).reduce((s, k) => s + total(k), 0) : bal.get(a.id) ?? 0);
  const sign = (root: string) => (root === "asset" || root === "expense" ? 1 : -1);

  const rows: React.ReactNode[] = [];
  const walk = (a: Acc, depth: number) => {
    const v = total(a) * sign(a.root_type);
    rows.push(
      <tr key={a.id} className={a.active ? "" : "text-cx-faint"}>
        <td className="px-3 py-2 first:pl-5" style={{ paddingLeft: 20 + depth * 18 }}>
          {a.is_group ? <span className="font-medium text-cx-text">{a.name}</span>
            : <Link href={`/reports?r=ledger&account=${a.id}`} className={a.active ? "text-cx-text hover:underline" : "hover:underline"}>{a.name}</Link>}
          <span className="ml-2 text-[12px] text-cx-faint">{a.code}</span>
        </td>
        <td className="px-3 py-2 text-[12.5px] text-cx-muted">{a.account_type ? TYPE_LABEL[a.account_type] : ""}{!a.active ? " (off)" : ""}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${a.is_group ? "font-medium text-cx-text" : "text-cx-text-2"}`}>{amt(v, true)}</td>
        <td className="px-3 py-2 text-right last:pr-5">
          {canWrite && !a.is_group && !a.account_type?.match(/receivable|payable|tax|round_off/) && (
            <ActionForm action={toggleAccount}>
              <input type="hidden" name="id" value={a.id} /><input type="hidden" name="active" value={a.active ? "0" : "1"} />
              <Submit className={btnQuiet} pending="...">{a.active ? "Turn off" : "Turn on"}</Submit>
            </ActionForm>
          )}
        </td>
      </tr>,
    );
    for (const k of kids.get(a.id) ?? []) walk(k, depth + 1);
  };
  for (const root of kids.get(null) ?? []) walk(root, 0);
  const groups = accounts.filter((a) => a.is_group);

  return (
    <div>
      <PageHeader title="Chart of accounts" sub={`Balances as of today; income and expenses for ${fy.label}`} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Section flush>
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead><tr className="border-b border-cx-line text-left text-[12.5px] text-cx-muted">
                <th className="px-3 py-2.5 pl-5 font-medium">Account</th><th className="px-3 py-2.5 font-medium">Kind</th><th className="px-3 py-2.5 text-right font-medium">Balance</th><th className="pr-5" />
              </tr></thead>
              <tbody className="divide-y divide-cx-line">{rows}</tbody>
            </table>
          </div>
        </Section>
        {canWrite && (
          <Section title="Add an account">
            <ActionForm action={addAccount} reset className="space-y-3">
              <div>
                <label htmlFor="parent_id" className={labelCls}>Under</label>
                <select id="parent_id" name="parent_id" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Choose a group</option>
                  {(["asset", "liability", "equity", "income", "expense"] as const).map((r) => (
                    <optgroup key={r} label={ROOT_LABEL[r]}>
                      {groups.filter((g) => g.root_type === r).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3">
                <div><label htmlFor="code" className={labelCls}>Code</label><input id="code" name="code" required maxLength={15} placeholder="5215" className={`${inputCls} uppercase`} /></div>
                <div><label htmlFor="name" className={labelCls}>Name</label><input id="name" name="name" required maxLength={120} className={inputCls} /></div>
              </div>
              <div>
                <label htmlFor="account_type" className={labelCls}>Kind</label>
                <select id="account_type" name="account_type" defaultValue="" className={inputCls}>
                  <option value="">Ordinary account</option><option value="bank">Bank account</option><option value="cash">Cash</option><option value="fixed_asset">Fixed asset</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-[13.5px] text-cx-text-2"><input type="checkbox" name="is_group" className="h-4 w-4 accent-cx-text" /> A group that holds other accounts</label>
              <Submit className={btnPrimary} pending="Adding">Add account</Submit>
            </ActionForm>
            <p className="mt-3 text-[12.5px] text-cx-muted">Add each bank account as its own account under Bank accounts, so receipts and payments can use it. <Link href="/reports?r=tb" className={linkCls}>See the trial balance</Link></p>
          </Section>
        )}
      </div>
    </div>
  );
}
