import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBooks } from "@/lib/context";
import { fmtDate, amt, inr, KIND_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, btnPrimary, btnGhost, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { PartyFields } from "@/components/party-fields";
import { saveParty } from "../../actions";

export const metadata = { title: "Statement" };

export default async function PartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, org, canWrite } = await requireBooks();
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const id = Number(raw);
  const { data: p } = await db.from("party").select("*").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (!p) notFound();
  const { data: gl } = await db.from("gl_entry").select("id, date, debit, credit, is_reversal, voucher_id, voucher:voucher!gl_entry_org_id_voucher_id_fkey(kind, number)")
    .eq("org_id", org.id).eq("party_id", id).order("date").order("id").limit(2000);
  const rows = (gl ?? []).reduce<(NonNullable<typeof gl>[number] & { run: number })[]>((acc, g) => {
    const prev = acc.length ? acc[acc.length - 1].run : 0;
    acc.push({ ...g, run: Math.round((prev + Number(g.debit) - Number(g.credit)) * 100) / 100 });
    return acc;
  }, []);
  const run = rows.length ? rows[rows.length - 1].run : 0;

  return (
    <div>
      <PageHeader title={p.name} sub={run === 0 ? "Settled" : run > 0 ? `Owes you ${inr(run)}` : `You owe ${inr(-run)}`}>
        {canWrite && (p.kind !== "vendor") && <Link href={`/sales/new?party=${id}`} className={btnPrimary}>New invoice</Link>}
        {canWrite && (p.kind !== "customer") && <Link href={`/purchases/new?party=${id}`} className={btnGhost}>New bill</Link>}
      </PageHeader>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="Statement" desc="Every entry with this customer or vendor" flush>
          {rows.length ? (
            <Table head={[{ label: "Date" }, { label: "Document" }, { label: "Debit", right: true }, { label: "Credit", right: true }, { label: "Balance", right: true }]}>
              {rows.map((g) => {
                const v = g.voucher as unknown as { kind: string; number: string };
                return (
                  <tr key={g.id}>
                    <td className={td}>{fmtDate(g.date)}</td>
                    <td className={td}><Link href={`/v/${g.voucher_id}`} className={linkCls}>{KIND_LABEL[v?.kind]} {v?.number}</Link>{g.is_reversal && <span className="ml-1 text-[12px] text-cx-muted">(cancelled)</span>}</td>
                    <td className={`${td} text-right tabular-nums`}>{amt(g.debit, true)}</td>
                    <td className={`${td} text-right tabular-nums`}>{amt(g.credit, true)}</td>
                    <td className={`${td} text-right tabular-nums`}>{amt(g.run)}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <Empty>No entries yet.</Empty>}
        </Section>
        {canWrite && (
          <Section title="Details">
            <ActionForm action={saveParty} className="space-y-4">
              <input type="hidden" name="id" value={p.id} />
              <PartyFields v={p} />
              <Submit className={btnGhost}>Save</Submit>
            </ActionForm>
          </Section>
        )}
      </div>
    </div>
  );
}
