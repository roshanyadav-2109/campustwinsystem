import "server-only";
import type { Ctx } from "@/lib/context";

type Db = Ctx["db"];
export type Kind = "sales_invoice" | "purchase_bill" | "receipt" | "payment" | "journal";

// Posted invoices (or bills) with what is still due, worked out from posted
// receipts (or payments) matched against them.
export async function openDocs(db: Db, org: string, kind: "sales_invoice" | "purchase_bill", partyId?: number) {
  let q = db.from("voucher").select("id, number, date, due_date, party_id, total").eq("org_id", org).eq("kind", kind).eq("status", "posted").order("date");
  if (partyId) q = q.eq("party_id", partyId);
  const { data: docs } = await q.limit(2000);
  if (!docs?.length) return [];
  const { data: allocs } = await db.from("allocation").select("against_id, amount, voucher:voucher!allocation_org_id_voucher_id_fkey(status)").in("against_id", docs.map((d) => d.id));
  const paid = new Map<number, number>();
  for (const a of allocs ?? []) {
    const status = (a.voucher as unknown as { status: string } | null)?.status;
    if (status === "posted") paid.set(a.against_id, (paid.get(a.against_id) ?? 0) + Number(a.amount));
  }
  return docs
    .map((d) => ({ id: d.id, number: d.number ?? "", date: d.date, due_date: d.due_date, party_id: d.party_id!, total: Number(d.total), due: Math.round((Number(d.total) - (paid.get(d.id) ?? 0)) * 100) / 100 }))
    .filter((d) => d.due > 0);
}

// Everything a document form offers to choose from.
export async function formChoices(db: Db, org: string, kind: Kind) {
  const partyKinds = kind === "sales_invoice" || kind === "receipt" ? ["customer", "both"] : kind === "journal" ? ["customer", "vendor", "both"] : ["vendor", "both"];
  const roots = kind === "sales_invoice" ? ["income"] : kind === "purchase_bill" ? ["expense", "asset"] : null;
  const [{ data: parties }, { data: accounts }, { data: cash }, { data: settings }] = await Promise.all([
    db.from("party").select("id, name, state_code").eq("org_id", org).eq("active", true).in("kind", partyKinds).order("name"),
    (() => {
      let q = db.from("account").select("id, code, name, root_type, account_type").eq("org_id", org).eq("active", true).eq("is_group", false).order("code");
      if (roots) q = q.in("root_type", roots);
      return q;
    })(),
    db.from("account").select("id, code, name").eq("org_id", org).eq("active", true).eq("is_group", false).in("account_type", ["bank", "cash"]).order("code"),
    db.from("settings").select("state_code").eq("org_id", org).single(),
  ]);
  // Bills can buy fixed assets, but not post to receivable, tax or bank accounts.
  const usable = (accounts ?? []).filter((a) => kind === "journal" || !a.account_type || a.account_type === "fixed_asset");
  const docKind = kind === "receipt" ? "sales_invoice" : kind === "payment" ? "purchase_bill" : null;
  return {
    parties: (parties ?? []).map((p) => ({ id: p.id, name: p.name, state_code: p.state_code })),
    accounts: usable.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    cashAccounts: (cash ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    openDocs: docKind ? await openDocs(db, org, docKind) : [],
    orgState: settings?.state_code ?? null,
  };
}

// Closing balance of every posting account up to a date (debit minus credit).
export async function balances(db: Db, org: string, from: string, to: string) {
  const { data } = await db.rpc("trial_balance", { p_org: org, p_from: from, p_to: to });
  return (data ?? []).map((r) => ({ ...r, opening: Number(r.opening), debit: Number(r.debit), credit: Number(r.credit), closing: Number(r.closing) }));
}
