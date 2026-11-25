import Link from "next/link";
import { requireBooks } from "@/lib/context";
import { stateName, amt } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputBase, btnGhost, btnPrimary, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { PartyFields } from "@/components/party-fields";
import { saveParty } from "../actions";

export const metadata = { title: "Customers and vendors" };

export default async function Parties({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const { db, org, canWrite } = await requireBooks();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().replace(/[%_,()\\"*:]/g, " ").trim().slice(0, 60);
  const kind = ["customer", "vendor"].includes(sp.kind ?? "") ? sp.kind! : "all";

  let query = db.from("party").select("id, kind, name, gstin, state_code, phone").eq("org_id", org.id).order("name").limit(500);
  if (q) query = query.ilike("name", `%${q}%`);
  if (kind !== "all") query = query.in("kind", [kind, "both"]);
  const [{ data: rows }, { data: gl }] = await Promise.all([
    query,
    db.from("gl_entry").select("party_id, debit, credit").eq("org_id", org.id).not("party_id", "is", null).limit(50000),
  ]);
  // Positive: they owe you. Negative: you owe them.
  const bal = new Map<number, number>();
  for (const g of gl ?? []) bal.set(g.party_id!, (bal.get(g.party_id!) ?? 0) + Number(g.debit) - Number(g.credit));

  return (
    <div>
      <PageHeader title="Customers and vendors" sub="Who you bill and who bills you" />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <form className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="filter-q" className="sr-only">Search</label>
            <input id="filter-q" name="q" defaultValue={q} placeholder="Name" className={`${inputBase} w-56`} />
            <label htmlFor="filter-kind" className="sr-only">Show</label>
            <select id="filter-kind" name="kind" defaultValue={kind} className={`${inputBase} w-auto`}>
              <option value="all">Everyone</option><option value="customer">Customers</option><option value="vendor">Vendors</option>
            </select>
            <button className={btnGhost}>Show</button>
          </form>
          <Section flush>
            {rows?.length ? (
              <Table head={[{ label: "Name" }, { label: "State" }, { label: "Balance", right: true }]}>
                {rows.map((p) => {
                  const b = Math.round((bal.get(p.id) ?? 0) * 100) / 100;
                  return (
                    <tr key={p.id}>
                      <td className={td}><Link href={`/parties/${p.id}`} className={linkCls}>{p.name}</Link>
                        <div className="text-[12px] text-cx-muted">{p.kind === "both" ? "Customer and vendor" : p.kind === "customer" ? "Customer" : "Vendor"}{p.gstin ? `, ${p.gstin}` : ""}</div></td>
                      <td className={td}>{stateName(p.state_code)}</td>
                      <td className={`${td} text-right tabular-nums`}>{b === 0 ? "" : b > 0 ? `${amt(b)} owed to you` : `${amt(-b)} you owe`}</td>
                    </tr>
                  );
                })}
              </Table>
            ) : <Empty>{q || kind !== "all" ? "Nobody matches." : "No customers or vendors yet."}</Empty>}
          </Section>
        </div>
        {canWrite && (
          <Section title="Add">
            <ActionForm action={saveParty} reset className="space-y-4">
              <PartyFields />
              <Submit className={btnPrimary} pending="Adding">Add</Submit>
            </ActionForm>
          </Section>
        )}
      </div>
    </div>
  );
}
