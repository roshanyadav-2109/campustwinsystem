import Link from "next/link";
import { requireStaff } from "@/lib/context";
import { fmtDate } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputCls, inputBase, labelCls, btnPrimary, btnGhost, linkCls, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { ProfileFields } from "@/components/profile-fields";
import { addAlumnus, importAlumni, reviewRequest } from "../../actions";

export const metadata = { title: "Alumni records" };
const PAGE = 50;

export default async function AlumniRecords({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { db, org } = await requireStaff();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().replace(/[%_,()\\"*:]/g, " ").trim().slice(0, 60);
  const status = ["pending", "verified", "rejected"].includes(sp.status ?? "") ? sp.status! : "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ data: pending }, list, { data: s }] = await Promise.all([
    db.from("member").select("id, full_name, email, batch_year, programme, roll_number, city, company, created_at").eq("org_id", org.id).eq("status", "pending").order("created_at").limit(50),
    (() => {
      let qq = db.from("member").select("id, full_name, email, batch_year, programme, status, user_id, source", { count: "exact" }).eq("org_id", org.id);
      if (status !== "all") qq = qq.eq("status", status);
      if (q) qq = qq.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,programme.ilike.%${q}%,roll_number.ilike.%${q}%`);
      return qq.order("batch_year", { ascending: false, nullsFirst: false }).order("full_name").range((page - 1) * PAGE, page * PAGE - 1);
    })(),
    db.from("settings").select("join_code, join_open").eq("org_id", org.id).single(),
  ]);
  const total = list.count ?? 0;
  const link = (p: number) => `/office/alumni?${new URLSearchParams({ ...(q && { q }), ...(status !== "all" && { status }), page: String(p) })}`;

  return (
    <div>
      <PageHeader title="Alumni records" sub={`${total} ${status === "all" ? "in total" : status}`} />
      {!!pending?.length && (
        <div className="mb-4">
          <Section title="Requests to join" desc="Check each against your records before approving" flush>
            <ul className="divide-y divide-cx-line">
              {pending.map((m) => (
                <li key={m.id} className="grid gap-2 px-5 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0 text-[14px]">
                    <Link href={`/office/alumni/${m.id}`} className={linkCls}>{m.full_name}</Link>
                    <span className="text-cx-muted">, batch {m.batch_year}{m.programme ? `, ${m.programme}` : ""}{m.roll_number ? `, roll ${m.roll_number}` : ""}</span>
                    <div className="text-[12.5px] text-cx-muted">{[m.email, m.company, m.city, `asked ${fmtDate(m.created_at)}`].filter(Boolean).join(", ")}</div>
                  </div>
                  <div className="flex gap-2">
                    <ActionForm action={reviewRequest}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="decision" value="verified" /><Submit className={btnPrimary} pending="Approving">Approve</Submit></ActionForm>
                    <ActionForm action={reviewRequest}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="decision" value="rejected" /><Submit className={btnGhost} pending="Declining">Decline</Submit></ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div>
          <form className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="filter-q" className="sr-only">Search</label>
            <input id="filter-q" name="q" defaultValue={q} placeholder="Name, email, course or roll" className={`${inputBase} w-64`} />
            <label htmlFor="filter-status" className="sr-only">Status</label>
            <select id="filter-status" name="status" defaultValue={status} className={`${inputBase} w-auto`}>
              <option value="all">Everyone</option><option value="verified">Verified</option><option value="pending">Waiting for review</option><option value="rejected">Declined</option>
            </select>
            <button className={btnGhost}>Show</button>
          </form>
          <Section flush>
            {list.data?.length ? (
              <Table head={[{ label: "Name" }, { label: "Batch" }, { label: "Status" }]}>
                {list.data.map((m) => (
                  <tr key={m.id}>
                    <td className={td}><Link href={`/office/alumni/${m.id}`} className={linkCls}>{m.full_name}</Link>
                      <div className="text-[12px] text-cx-muted">{[m.programme, m.email].filter(Boolean).join(", ")}</div></td>
                    <td className={`${td} tabular-nums`}>{m.batch_year ?? ""}</td>
                    <td className={td}>
                      <Status tone={m.status === "verified" ? "ok" : m.status === "pending" ? "warn" : "off"}>{m.status === "verified" ? (m.user_id ? "Verified, signed in" : "Verified") : m.status === "pending" ? "Waiting" : "Declined"}</Status>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : <Empty>{q || status !== "all" ? "Nobody matches." : "No alumni yet. Add them, import a list, or share your join link."}</Empty>}
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

        <div className="space-y-4">
          {s && (
            <Section title="Join link">
              <p className="break-all font-mono text-[12.5px] text-cx-text">https://alumni.campustwin.org/join/{s.join_code}</p>
              <p className="mt-1 text-[12.5px] text-cx-muted">{s.join_open ? "Share it with alumni. Each request waits here for approval." : "Closed. Open it in settings."}</p>
            </Section>
          )}
          <Section title="Add one">
            <ActionForm action={addAlumnus} reset className="space-y-3">
              <div><label htmlFor="full_name" className={labelCls}>Full name</label><input id="full_name" name="full_name" required maxLength={150} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="email" className={labelCls}>Email</label><input id="email" name="email" type="email" className={inputCls} /></div>
                <div><label htmlFor="batch_year" className={labelCls}>Batch (year passed out)</label><input id="batch_year" name="batch_year" type="number" min={1900} max={2100} className={inputCls} /></div>
              </div>
              <div><label htmlFor="roll_number" className={labelCls}>Roll number</label><input id="roll_number" name="roll_number" maxLength={40} className={inputCls} /></div>
              <details><summary className="cursor-pointer text-[13px] text-cx-link">More details</summary><div className="mt-3"><ProfileFields /></div></details>
              <Submit className={btnPrimary} pending="Adding">Add</Submit>
            </ActionForm>
          </Section>
          <Section title="Import a list">
            <ActionForm action={importAlumni} reset className="space-y-2">
              <label htmlFor="rows" className={labelCls}>Copy rows from Excel, including the header row</label>
              <textarea id="rows" name="rows" rows={6} required placeholder={"Name\tEmail\tBatch\tCourse\tCompany\tCity\nRiya Shah\triya@example.com\t2018\tB.Com\tDeloitte\tPune"} className={`${inputCls} font-mono text-[12.5px]`} />
              <p className="text-[12px] text-cx-faint">Columns it understands: Name, Email, Batch, Course, Roll number, Company, Job title, City, Country, Phone. Everyone imported is verified; emails already listed are skipped.</p>
              <Submit className={btnGhost} pending="Importing">Import</Submit>
            </ActionForm>
          </Section>
        </div>
      </div>
    </div>
  );
}
