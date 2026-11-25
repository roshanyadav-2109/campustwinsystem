"use client";
import { useMemo, useState } from "react";
import { ActionForm, Submit, type ActionResult } from "@/components/action-form";
import { inputCls, labelCls, btnPrimary, btnGhost, btnQuiet } from "@/components/ui";

type Opt = { id: number; name: string };
type Party = Opt & { state_code: string | null };
type Account = Opt & { code: string };
type OpenDoc = { id: number; number: string; date: string; party_id: number; due: number };
type Item = { description: string; account: string; qty: string; rate: string; tax: string };
type Line = { account: string; party: string; debit: string; credit: string; memo: string };
export type Initial = {
  id?: number; date: string; due_date?: string | null; party_id?: number | null; reference?: string | null; narration?: string | null;
  amount?: number | null; cash_account_id?: number | null;
  items?: Item[]; lines?: Line[]; allocations?: Record<number, string>;
};

const RATES = ["0", "5", "12", "18", "28"];
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => { const n = Number((s || "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

const KIND_TEXT = {
  sales_invoice: { party: "Customer", lines: "What you are billing for" },
  purchase_bill: { party: "Vendor", lines: "What you are paying for" },
  receipt: { party: "Received from", lines: "" },
  payment: { party: "Paid to", lines: "" },
  journal: { party: "", lines: "Entries" },
} as const;

// One form for every kind of document. Saves as a draft, or saves and posts.
export function VoucherForm({ kind, action, initial, parties, accounts, cashAccounts, openDocs, orgState, canPost }: {
  kind: keyof typeof KIND_TEXT;
  action: (prev: ActionResult, f: FormData) => Promise<ActionResult>;
  initial: Initial;
  parties: Party[];
  accounts: Account[];
  cashAccounts: Account[];
  openDocs: OpenDoc[];
  orgState: string | null;
  canPost: boolean;
}) {
  const text = KIND_TEXT[kind];
  const [party, setParty] = useState(initial.party_id ? String(initial.party_id) : "");
  const [items, setItems] = useState<Item[]>(initial.items?.length ? initial.items : [{ description: "", account: "", qty: "1", rate: "", tax: "0" }]);
  const [lines, setLines] = useState<Line[]>(initial.lines?.length ? initial.lines : [
    { account: "", party: "", debit: "", credit: "", memo: "" }, { account: "", party: "", debit: "", credit: "", memo: "" },
  ]);
  const [amount, setAmount] = useState(initial.amount ? String(initial.amount) : "");
  const [alloc, setAlloc] = useState<Record<number, string>>(initial.allocations ?? {});

  const partyState = parties.find((p) => String(p.id) === party)?.state_code ?? null;
  const interstate = !!orgState && !!partyState && orgState !== partyState;
  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const it of items) { const a = r2(num(it.qty) * num(it.rate)); sub += a; tax += r2(a * num(it.tax) / 100); }
    return { sub: r2(sub), tax: r2(tax), total: r2(sub + tax) };
  }, [items]);
  const jTotals = useMemo(() => ({ dr: r2(lines.reduce((s, l) => s + num(l.debit), 0)), cr: r2(lines.reduce((s, l) => s + num(l.credit), 0)) }), [lines]);
  const docs = openDocs.filter((d) => String(d.party_id) === party);
  const matched = r2(Object.entries(alloc).filter(([id]) => docs.some((d) => String(d.id) === id)).reduce((s, [, v]) => s + num(v), 0));

  const setItem = (i: number, k: keyof Item, v: string) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const setLine = (i: number, k: keyof Line, v: string) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const partyOpts = parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>);
  const accountOpts = accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>);

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="kind" value={kind} />
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kind !== "journal" && (
          <div className="lg:col-span-2">
            <label htmlFor="party_id" className={labelCls}>{text.party}</label>
            <select id="party_id" name="party_id" value={party} onChange={(e) => setParty(e.target.value)} required className={inputCls}>
              <option value="" disabled>Choose</option>
              {partyOpts}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="date" className={labelCls}>Date</label>
          <input id="date" name="date" type="date" required defaultValue={initial.date} className={inputCls} />
        </div>
        {(kind === "sales_invoice" || kind === "purchase_bill") && (
          <div>
            <label htmlFor="due_date" className={labelCls}>Due by</label>
            <input id="due_date" name="due_date" type="date" defaultValue={initial.due_date ?? ""} className={inputCls} />
          </div>
        )}
        {(kind === "receipt" || kind === "payment") && (
          <>
            <div>
              <label htmlFor="amount" className={labelCls}>Amount (₹)</label>
              <input id="amount" name="amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} text-right tabular-nums`} />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="cash_account_id" className={labelCls}>{kind === "receipt" ? "Into" : "From"}</label>
              <select id="cash_account_id" name="cash_account_id" required defaultValue={initial.cash_account_id ?? cashAccounts[0]?.id ?? ""} className={inputCls}>
                {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </>
        )}
        <div className={kind === "journal" ? "sm:col-span-1 lg:col-span-3" : "lg:col-span-2"}>
          <label htmlFor="reference" className={labelCls}>{kind === "purchase_bill" ? "Vendor's bill number" : kind === "receipt" || kind === "payment" ? "Cheque or UPI reference" : "Reference"}</label>
          <input id="reference" name="reference" maxLength={80} defaultValue={initial.reference ?? ""} className={inputCls} />
        </div>
      </div>

      {(kind === "sales_invoice" || kind === "purchase_bill") && (
        <div>
          <p className="mb-2 text-[13px] font-medium text-cx-text-2">{text.lines}</p>
          <div className="overflow-x-auto rounded-md border border-cx-line">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr className="border-b border-cx-line bg-cx-raised text-left text-[12.5px] text-cx-muted">
                  <th className="px-2 py-2 font-medium">Description</th><th className="px-2 py-2 font-medium">Account</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Qty</th><th className="w-32 px-2 py-2 text-right font-medium">Rate (₹)</th>
                  <th className="w-24 px-2 py-2 font-medium">GST</th><th className="w-32 px-2 py-2 text-right font-medium">Amount</th><th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-cx-line">
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} description`} name="item_description" value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} maxLength={300} className={inputCls} /></td>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Line ${i + 1} account`} name="item_account" value={it.account} onChange={(e) => setItem(i, "account", e.target.value)} className={inputCls}>
                        <option value="">Choose</option>{accountOpts}
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} quantity`} name="item_qty" inputMode="decimal" value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} className={`${inputCls} text-right tabular-nums`} /></td>
                    <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} rate`} name="item_rate" inputMode="decimal" value={it.rate} onChange={(e) => setItem(i, "rate", e.target.value)} className={`${inputCls} text-right tabular-nums`} /></td>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Line ${i + 1} GST`} name="item_tax" value={it.tax} onChange={(e) => setItem(i, "tax", e.target.value)} className={inputCls}>
                        {RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-cx-text">{fmt(r2(num(it.qty) * num(it.rate)))}</td>
                    <td className="px-2 py-1.5 text-center">
                      {items.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className={btnQuiet}>Remove</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <button type="button" onClick={() => setItems((xs) => [...xs, { description: "", account: "", qty: "1", rate: "", tax: xs[xs.length - 1]?.tax ?? "0" }])} className={btnGhost}>Add line</button>
            <dl className="grid min-w-[260px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13.5px]">
              <dt className="text-cx-muted">Before tax</dt><dd className="text-right tabular-nums">{fmt(totals.sub)}</dd>
              {interstate
                ? <><dt className="text-cx-muted">IGST</dt><dd className="text-right tabular-nums">{fmt(totals.tax)}</dd></>
                : <><dt className="text-cx-muted">CGST</dt><dd className="text-right tabular-nums">{fmt(r2(totals.tax / 2))}</dd>
                    <dt className="text-cx-muted">SGST</dt><dd className="text-right tabular-nums">{fmt(r2(totals.tax - r2(totals.tax / 2)))}</dd></>}
              <dt className="border-t border-cx-line pt-1 font-semibold text-cx-text">Total</dt><dd className="border-t border-cx-line pt-1 text-right font-semibold tabular-nums text-cx-text">₹{fmt(totals.total)}</dd>
            </dl>
          </div>
          {party && <p className="mt-1 text-[12.5px] text-cx-muted">{interstate ? "Different state: IGST applies." : "Same state: CGST and SGST apply."}</p>}
        </div>
      )}

      {(kind === "receipt" || kind === "payment") && (
        <div>
          <p className="mb-2 text-[13px] font-medium text-cx-text-2">{kind === "receipt" ? "Which invoices this pays" : "Which bills this pays"}</p>
          {!party ? <p className="text-[13.5px] text-cx-muted">Choose {kind === "receipt" ? "the customer" : "the vendor"} to see what is still due.</p>
            : docs.length ? (
              <div className="overflow-x-auto rounded-md border border-cx-line">
                <table className="w-full text-[13.5px]">
                  <thead><tr className="border-b border-cx-line bg-cx-raised text-left text-[12.5px] text-cx-muted"><th className="px-3 py-2 font-medium">Number</th><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 text-right font-medium">Still due</th><th className="w-40 px-3 py-2 text-right font-medium">Pay now (₹)</th></tr></thead>
                  <tbody className="divide-y divide-cx-line">
                    {docs.map((d) => (
                      <tr key={d.id}>
                        <td className="px-3 py-1.5 text-cx-text">{d.number}</td>
                        <td className="px-3 py-1.5 text-cx-text-2">{new Date(d.date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(d.due)}</td>
                        <td className="px-3 py-1.5">
                          <input type="hidden" name="alloc_id" value={d.id} />
                          <input aria-label={`Amount for ${d.number}`} name="alloc_amount" inputMode="decimal" value={alloc[d.id] ?? ""} onChange={(e) => setAlloc((a) => ({ ...a, [d.id]: e.target.value }))} className={`${inputCls} text-right tabular-nums`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-[13.5px] text-cx-muted">Nothing is due. The whole amount is kept as an advance.</p>}
          {party && docs.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-cx-muted">
              <button type="button" className={btnGhost} onClick={() => {
                let left = num(amount);
                const next: Record<number, string> = {};
                for (const d of docs) { const take = r2(Math.min(left, d.due)); if (take > 0) next[d.id] = String(take); left = r2(left - take); }
                setAlloc(next);
              }}>Match oldest first</button>
              <span>Matched ₹{fmt(matched)} of ₹{fmt(num(amount))}{num(amount) > matched ? `; ₹${fmt(r2(num(amount) - matched))} kept as advance` : ""}</span>
            </div>
          )}
        </div>
      )}

      {kind === "journal" && (
        <div>
          <div className="overflow-x-auto rounded-md border border-cx-line">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr className="border-b border-cx-line bg-cx-raised text-left text-[12.5px] text-cx-muted">
                  <th className="px-2 py-2 font-medium">Account</th><th className="px-2 py-2 font-medium">Customer or vendor</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Debit (₹)</th><th className="w-32 px-2 py-2 text-right font-medium">Credit (₹)</th>
                  <th className="px-2 py-2 font-medium">Note</th><th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-cx-line">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5"><select aria-label={`Line ${i + 1} account`} name="line_account" value={l.account} onChange={(e) => setLine(i, "account", e.target.value)} className={inputCls}><option value="">Choose</option>{accountOpts}</select></td>
                    <td className="px-2 py-1.5"><select aria-label={`Line ${i + 1} party`} name="line_party" value={l.party} onChange={(e) => setLine(i, "party", e.target.value)} className={inputCls}><option value="">None</option>{partyOpts}</select></td>
                    <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} debit`} name="line_debit" inputMode="decimal" value={l.debit} onChange={(e) => setLine(i, "debit", e.target.value)} className={`${inputCls} text-right tabular-nums`} /></td>
                    <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} credit`} name="line_credit" inputMode="decimal" value={l.credit} onChange={(e) => setLine(i, "credit", e.target.value)} className={`${inputCls} text-right tabular-nums`} /></td>
                    <td className="px-2 py-1.5"><input aria-label={`Line ${i + 1} note`} name="line_memo" maxLength={200} value={l.memo} onChange={(e) => setLine(i, "memo", e.target.value)} className={inputCls} /></td>
                    <td className="px-2 py-1.5 text-center">{lines.length > 2 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))} className={btnQuiet}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setLines((xs) => [...xs, { account: "", party: "", debit: "", credit: "", memo: "" }])} className={btnGhost}>Add line</button>
            <p className={`text-[13.5px] tabular-nums ${jTotals.dr === jTotals.cr && jTotals.dr > 0 ? "text-cx-text-2" : "text-cx-bad"}`}>
              Debits ₹{fmt(jTotals.dr)}, credits ₹{fmt(jTotals.cr)}{jTotals.dr !== jTotals.cr ? `, difference ₹${fmt(Math.abs(r2(jTotals.dr - jTotals.cr)))}` : ""}
            </p>
          </div>
        </div>
      )}

      <div>
        <label htmlFor="narration" className={labelCls}>Note (optional)</label>
        <textarea id="narration" name="narration" rows={2} maxLength={500} defaultValue={initial.narration ?? ""} className={inputCls} />
      </div>

      <div className="flex flex-wrap gap-2">
        {canPost && <button type="submit" name="then" value="post" className={btnPrimary}>Save and post</button>}
        <Submit className={btnGhost} pending="Saving">Save as draft</Submit>
      </div>
    </ActionForm>
  );
}
