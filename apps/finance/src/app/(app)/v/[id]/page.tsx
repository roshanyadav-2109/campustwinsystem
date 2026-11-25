import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBooks } from "@/lib/context";
import { formChoices, type Kind } from "@/lib/data";
import { fmtDate, amt, inr, stateName, KIND_LABEL, KIND_PATH } from "@/lib/format";
import { PageHeader, Section, Table, td, btnPrimary, btnGhost, btnDanger, linkCls, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { VoucherForm } from "@/components/voucher-form";
import { saveDraft, postVoucher, cancelVoucher, deleteDraft } from "../../actions";

export const metadata = { title: "Document" };

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ problem?: string }> }) {
  const { db, org, canWrite } = await requireBooks();
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const id = Number(raw);
  const problem = ((await searchParams).problem ?? "").slice(0, 300);
  const { data: v, error: loadError } = await db.from("voucher").select("*, party:party!voucher_org_id_party_id_fkey(id, name, gstin, state_code, address)").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (loadError) throw new Error("Could not load this document: " + loadError.message);
  if (!v) notFound();
  const kind = v.kind as Kind;
  const party = v.party as unknown as { id: number; name: string; gstin: string | null; state_code: string | null; address: string | null } | null;

  const [items, lines, allocs, against, gl, settings] = await Promise.all([
    db.from("voucher_item").select("line_no, description, qty, rate, tax_rate, amount, account_id, account:account!voucher_item_org_id_account_id_fkey(code, name)").eq("voucher_id", id).order("line_no"),
    db.from("journal_line").select("line_no, account_id, party_id, debit, credit, memo, account:account!journal_line_org_id_account_id_fkey(code, name), party:party!journal_line_org_id_party_id_fkey(name)").eq("voucher_id", id).order("line_no"),
    db.from("allocation").select("against_id, amount, doc:voucher!allocation_org_id_against_id_fkey(number, date, total)").eq("voucher_id", id),
    db.from("allocation").select("voucher_id, amount, doc:voucher!allocation_org_id_voucher_id_fkey(number, date, status)").eq("against_id", id),
    db.from("gl_entry").select("id, debit, credit, is_reversal, account:account!gl_entry_org_id_account_id_fkey(code, name), party:party!gl_entry_org_id_party_id_fkey(name)").eq("voucher_id", id).order("id"),
    db.from("settings").select("legal_name, gstin, state_code").eq("org_id", org.id).single(),
  ]);

  const title = `${KIND_LABEL[kind]} ${v.number ?? "(draft)"}`;
  const tone = v.status === "posted" ? "ok" : v.status === "draft" ? "warn" : "off";
  const statusText = v.status === "posted" ? "Posted" : v.status === "draft" ? "Draft, not in the books yet" : "Cancelled";
  const paidAgainst = (against.data ?? []).filter((a) => (a.doc as unknown as { status: string })?.status === "posted");
  const paid = paidAgainst.reduce((s, a) => s + Number(a.amount), 0);

  if (v.status === "draft" && canWrite) {
    const choices = await formChoices(db, org.id, kind);
    const initial = {
      id: v.id, date: v.date, due_date: v.due_date, party_id: v.party_id, reference: v.reference, narration: v.narration,
      amount: v.amount == null ? null : Number(v.amount), cash_account_id: v.cash_account_id,
      items: (items.data ?? []).map((i) => ({ description: i.description, account: String(i.account_id), qty: String(i.qty), rate: String(i.rate), tax: String(Number(i.tax_rate)) })),
      lines: (lines.data ?? []).map((l) => ({ account: String(l.account_id), party: l.party_id ? String(l.party_id) : "", debit: Number(l.debit) ? String(l.debit) : "", credit: Number(l.credit) ? String(l.credit) : "", memo: l.memo ?? "" })),
      allocations: Object.fromEntries((allocs.data ?? []).map((a) => [a.against_id, String(a.amount)])),
    };
    return (
      <div>
        <PageHeader title={title} sub={<Status tone="warn">{statusText}</Status>}>
          <ActionForm action={postVoucher}><input type="hidden" name="id" value={v.id} /><Submit className={btnPrimary} pending="Posting">Post</Submit></ActionForm>
          <ActionForm action={deleteDraft}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="back" value={KIND_PATH[kind]} /><Submit className={btnDanger} pending="Deleting">Delete draft</Submit></ActionForm>
        </PageHeader>
        {problem && <p role="alert" className="mb-3 rounded-md border border-cx-line bg-cx-card px-4 py-2.5 text-[13.5px] text-cx-bad">{problem}</p>}
        <Section title="Edit draft" desc="Posting checks it, gives it a number and writes it to the books.">
          <VoucherForm kind={kind} action={saveDraft} initial={initial} canPost {...choices} />
        </Section>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={title} sub={<Status tone={tone}>{statusText}</Status>}>
        <Link href={KIND_PATH[kind]} className={btnGhost}>All {KIND_LABEL[kind].toLowerCase()}s</Link>
        {canWrite && v.status === "posted" && (
          <ActionForm action={cancelVoucher}><input type="hidden" name="id" value={v.id} /><Submit className={btnDanger} pending="Cancelling">Cancel</Submit></ActionForm>
        )}
      </PageHeader>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section flush>
          <div className="grid gap-4 border-b border-cx-line p-5 text-[14px] sm:grid-cols-2">
            <div>
              <p className="text-[12.5px] text-cx-muted">From</p>
              <p className="font-medium text-cx-text">{settings.data?.legal_name ?? org.name}</p>
              {settings.data?.gstin && <p className="text-cx-text-2">GSTIN {settings.data.gstin}</p>}
              {settings.data?.state_code && <p className="text-cx-text-2">{stateName(settings.data.state_code)}</p>}
            </div>
            {party && (
              <div>
                <p className="text-[12.5px] text-cx-muted">{kind === "sales_invoice" || kind === "receipt" ? "Customer" : "Vendor"}</p>
                <Link href={`/parties/${party.id}`} className={linkCls}>{party.name}</Link>
                {party.gstin && <p className="text-cx-text-2">GSTIN {party.gstin}</p>}
                {party.address && <p className="whitespace-pre-line text-cx-text-2">{party.address}</p>}
              </div>
            )}
            <div><p className="text-[12.5px] text-cx-muted">Date</p><p className="text-cx-text">{fmtDate(v.date)}{v.due_date ? `, due ${fmtDate(v.due_date)}` : ""}</p></div>
            {v.reference && <div><p className="text-[12.5px] text-cx-muted">Reference</p><p className="text-cx-text">{v.reference}</p></div>}
          </div>

          {(kind === "sales_invoice" || kind === "purchase_bill") && (
            <>
              <Table head={[{ label: "Description" }, { label: "Qty", right: true }, { label: "Rate", right: true }, { label: "GST", right: true }, { label: "Amount", right: true }]}>
                {(items.data ?? []).map((i) => (
                  <tr key={i.line_no}>
                    <td className={td}><span className="text-cx-text">{i.description}</span><div className="text-[12px] text-cx-muted">{(i.account as unknown as { name: string })?.name}</div></td>
                    <td className={`${td} text-right tabular-nums`}>{Number(i.qty)}</td>
                    <td className={`${td} text-right tabular-nums`}>{amt(i.rate)}</td>
                    <td className={`${td} text-right tabular-nums`}>{Number(i.tax_rate)}%</td>
                    <td className={`${td} text-right tabular-nums`}>{amt(i.amount)}</td>
                  </tr>
                ))}
              </Table>
              <dl className="ml-auto grid max-w-[320px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-cx-line p-5 text-[14px]">
                <dt className="text-cx-muted">Before tax</dt><dd className="text-right tabular-nums">{amt(v.subtotal)}</dd>
                {v.interstate
                  ? <><dt className="text-cx-muted">IGST</dt><dd className="text-right tabular-nums">{amt(v.tax_total)}</dd></>
                  : <><dt className="text-cx-muted">CGST</dt><dd className="text-right tabular-nums">{amt(Math.round(Number(v.tax_total) * 50) / 100)}</dd>
                      <dt className="text-cx-muted">SGST</dt><dd className="text-right tabular-nums">{amt(Number(v.tax_total) - Math.round(Number(v.tax_total) * 50) / 100)}</dd></>}
                <dt className="border-t border-cx-line pt-1 font-semibold">Total</dt><dd className="border-t border-cx-line pt-1 text-right font-semibold tabular-nums">{inr(v.total)}</dd>
                {v.status === "posted" && <><dt className="text-cx-muted">Paid</dt><dd className="text-right tabular-nums">{amt(paid)}</dd>
                  <dt className="font-medium">Still due</dt><dd className="text-right font-medium tabular-nums">{amt(Number(v.total) - paid)}</dd></>}
              </dl>
            </>
          )}

          {(kind === "receipt" || kind === "payment") && (
            <div className="p-5 text-[14px]">
              <p className="text-[24px] font-semibold tabular-nums text-cx-text">{inr(v.amount)}</p>
              {allocs.data?.length ? (
                <ul className="mt-3 space-y-1 text-cx-text-2">
                  {allocs.data.map((a) => {
                    const d = a.doc as unknown as { number: string; date: string };
                    return <li key={a.against_id}>{amt(a.amount)} against <Link href={`/v/${a.against_id}`} className={linkCls}>{d?.number}</Link> of {fmtDate(d?.date)}</li>;
                  })}
                </ul>
              ) : <p className="mt-2 text-cx-muted">Not matched to any {kind === "receipt" ? "invoice" : "bill"}; kept as an advance.</p>}
            </div>
          )}

          {kind === "journal" && (
            <Table head={[{ label: "Account" }, { label: "Debit", right: true }, { label: "Credit", right: true }]}>
              {(lines.data ?? []).map((l) => (
                <tr key={l.line_no}>
                  <td className={td}><span className="text-cx-text">{(l.account as unknown as { code: string; name: string })?.code} {(l.account as unknown as { name: string })?.name}</span>
                    {(l.party as unknown as { name: string } | null)?.name && <div className="text-[12px] text-cx-muted">{(l.party as unknown as { name: string }).name}</div>}
                    {l.memo && <div className="text-[12px] text-cx-muted">{l.memo}</div>}</td>
                  <td className={`${td} text-right tabular-nums`}>{amt(l.debit, true)}</td>
                  <td className={`${td} text-right tabular-nums`}>{amt(l.credit, true)}</td>
                </tr>
              ))}
            </Table>
          )}
          {v.narration && <p className="border-t border-cx-line px-5 py-3 text-[13.5px] text-cx-text-2">{v.narration}</p>}
        </Section>

        <div className="space-y-4">
          <Section title="In the books" desc="Ledger entries this wrote" flush>
            <Table head={[{ label: "Account" }, { label: "Dr", right: true }, { label: "Cr", right: true }]}>
              {(gl.data ?? []).map((g) => (
                <tr key={g.id} className={g.is_reversal ? "text-cx-muted" : ""}>
                  <td className={td}>{(g.account as unknown as { name: string })?.name}{g.is_reversal && <span className="ml-1 text-[12px]">(reversal)</span>}</td>
                  <td className={`${td} text-right tabular-nums`}>{amt(g.debit, true)}</td>
                  <td className={`${td} text-right tabular-nums`}>{amt(g.credit, true)}</td>
                </tr>
              ))}
            </Table>
          </Section>
          {paidAgainst.length > 0 && (
            <Section title={kind === "sales_invoice" ? "Receipts" : "Payments"} flush>
              <ul className="divide-y divide-cx-line">
                {paidAgainst.map((a) => {
                  const d = a.doc as unknown as { number: string; date: string };
                  return <li key={a.voucher_id} className="flex justify-between px-5 py-2.5 text-[14px]"><Link href={`/v/${a.voucher_id}`} className={linkCls}>{d?.number}</Link><span className="tabular-nums">{amt(a.amount)}</span></li>;
                })}
              </ul>
            </Section>
          )}
          {canWrite && v.status === "posted" && (kind === "sales_invoice" || kind === "purchase_bill") && Number(v.total) - paid > 0 && party && (
            <Link href={`${kind === "sales_invoice" ? "/receipts" : "/payments"}/new?party=${party.id}`} className={btnPrimary}>Record {kind === "sales_invoice" ? "a receipt" : "a payment"}</Link>
          )}
        </div>
      </div>
    </div>
  );
}
