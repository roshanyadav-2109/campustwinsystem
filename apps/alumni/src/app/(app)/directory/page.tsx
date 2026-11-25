import Link from "next/link";
import { requireSetUp } from "@/lib/context";
import { PageHeader, Section, Empty, Table, td, inputBase, btnGhost, linkCls } from "@/components/ui";

export const metadata = { title: "Directory" };
const PAGE = 50;

// Alumni see verified alumni who chose to be listed; the alumni office sees
// everyone verified (row security decides which).
export default async function Directory({ searchParams }: { searchParams: Promise<{ q?: string; batch?: string; city?: string; page?: string }> }) {
  const { db, org, isStaff } = await requireSetUp();
  const sp = await searchParams;
  const clean = (v?: string) => (v ?? "").trim().replace(/[%_,()\\"*:]/g, " ").trim().slice(0, 60);
  const q = clean(sp.q), city = clean(sp.city);
  const batch = /^\d{4}$/.test(sp.batch ?? "") ? Number(sp.batch) : null;
  const page = Math.max(1, Number(sp.page) || 1);

  let query = db.from("member").select("id, full_name, batch_year, programme, company, job_title, higher_studies, city, linkedin_url", { count: "exact" })
    .eq("org_id", org.id).eq("status", "verified");
  if (q) query = query.or(`full_name.ilike.%${q}%,company.ilike.%${q}%,programme.ilike.%${q}%,job_title.ilike.%${q}%`);
  if (batch) query = query.eq("batch_year", batch);
  if (city) query = query.ilike("city", `%${city}%`);
  const { data: rows, count } = await query.order("batch_year", { ascending: false, nullsFirst: false }).order("full_name").range((page - 1) * PAGE, page * PAGE - 1);
  const total = count ?? 0;
  const link = (p: number) => `/directory?${new URLSearchParams({ ...(q && { q }), ...(batch && { batch: String(batch) }), ...(city && { city }), page: String(p) })}`;

  return (
    <div>
      <PageHeader title="Directory" sub={`${total} alumni${q || batch || city ? " match" : ""}`} />
      <form className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="sr-only">Name, company or course</label>
        <input id="q" name="q" defaultValue={q} placeholder="Name, company or course" className={`${inputBase} w-64`} />
        <label htmlFor="batch" className="sr-only">Batch</label>
        <input id="batch" name="batch" defaultValue={batch ?? ""} placeholder="Batch, e.g. 2016" inputMode="numeric" className={`${inputBase} w-36`} />
        <label htmlFor="city" className="sr-only">City</label>
        <input id="city" name="city" defaultValue={city} placeholder="City" className={`${inputBase} w-40`} />
        <button className={btnGhost}>Search</button>
      </form>
      <Section flush>
        {rows?.length ? (
          <Table head={[{ label: "Name" }, { label: "Batch" }, { label: "Now" }, { label: "City" }]}>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className={td}>
                  {isStaff ? <Link href={`/office/alumni/${m.id}`} className={linkCls}>{m.full_name}</Link> : <span className="font-medium text-cx-text">{m.full_name}</span>}
                  {m.linkedin_url && <a href={m.linkedin_url} target="_blank" rel="noreferrer" className="ml-2 text-[12px] text-cx-link hover:underline">LinkedIn</a>}
                  {m.programme && <div className="text-[12px] text-cx-muted">{m.programme}</div>}
                </td>
                <td className={`${td} tabular-nums`}>{m.batch_year ?? ""}</td>
                <td className={td}>{[m.job_title, m.company].filter(Boolean).join(", ") || m.higher_studies || ""}</td>
                <td className={td}>{m.city ?? ""}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>{q || batch || city ? "Nobody matches." : "Nobody is listed yet."}</Empty>}
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
