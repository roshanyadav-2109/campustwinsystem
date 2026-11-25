import Link from "next/link";
import { requireApprover } from "@/lib/context";
import { employmentLabel, STATUS_LABEL, fmtDate } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputBase, btnPrimary, btnGhost, linkCls, Status } from "@/components/ui";

export const metadata = { title: "Employees" };

const PAGE = 50;

export default async function Employees({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; status?: string; page?: string }> }) {
  const { db, org, isAdmin } = await requireApprover();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const dept = sp.dept && /^\d+$/.test(sp.dept) ? Number(sp.dept) : null;
  const status = ["active", "on_notice", "left", "all"].includes(sp.status ?? "") ? sp.status! : "current";
  const page = Math.max(1, Number(sp.page) || 1);

  let query = db.from("employee")
    .select("id, code, full_name, email, department_id, designation_id, employment_type, date_of_joining, status, user_id", { count: "exact" })
    .eq("org_id", org.id);
  if (q) {
    // Characters with meaning in the filter syntax are dropped, so a search can
    // never change the query itself.
    const safe = q.replace(/[%_,()\\"*:]/g, " ").trim();
    query = query.or(`full_name.ilike.%${safe}%,code.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  if (dept) query = query.eq("department_id", dept);
  if (status === "current") query = query.neq("status", "left");
  else if (status !== "all") query = query.eq("status", status);

  const [{ data: rows, count }, depts, desigs] = await Promise.all([
    query.order("full_name").range((page - 1) * PAGE, page * PAGE - 1),
    db.from("department").select("id, name").eq("org_id", org.id).order("name"),
    db.from("designation").select("id, name").eq("org_id", org.id),
  ]);
  const deptName = new Map((depts.data ?? []).map((d) => [d.id, d.name]));
  const desigName = new Map((desigs.data ?? []).map((d) => [d.id, d.name]));
  const total = count ?? 0;
  const link = (p: number) => `/employees?${new URLSearchParams({ ...(q && { q }), ...(dept && { dept: String(dept) }), ...(status !== "current" && { status }), page: String(p) })}`;

  return (
    <div>
      <PageHeader title="Employees" sub={`${total} ${status === "current" ? "current " : ""}employee${total === 1 ? "" : "s"}`}>
        {isAdmin && <Link href="/employees/new" className={btnPrimary}>Add employee</Link>}
      </PageHeader>

      <form className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="sr-only">Search</label>
        <input id="q" name="q" defaultValue={q} placeholder="Name, number or email" className={`${inputBase} w-64`} />
        <label htmlFor="dept" className="sr-only">Department</label>
        <select id="dept" name="dept" defaultValue={dept ?? ""} className={`${inputBase} w-auto`}>
          <option value="">All departments</option>
          {(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className={`${inputBase} w-auto`}>
          <option value="current">Current</option>
          <option value="active">Active</option>
          <option value="on_notice">On notice</option>
          <option value="left">Left</option>
          <option value="all">Everyone</option>
        </select>
        <button className={btnGhost}>Show</button>
      </form>

      <Section flush>
        {rows?.length ? (
          <Table head={[{ label: "Employee" }, { label: "Department" }, { label: "Type" }, { label: "Joined" }, { label: "Status" }]}>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className={td}>
                  <Link href={`/employees/${e.id}`} className={linkCls}>{e.full_name}</Link>
                  <div className="text-[12.5px] text-cx-muted">{e.code}{e.designation_id ? `, ${desigName.get(e.designation_id)}` : ""}{e.email && !e.user_id ? ", no login yet" : ""}</div>
                </td>
                <td className={td}>{e.department_id ? deptName.get(e.department_id) : ""}</td>
                <td className={td}>{employmentLabel(e.employment_type)}</td>
                <td className={td}>{fmtDate(e.date_of_joining)}</td>
                <td className={td}><Status tone={e.status === "active" ? "ok" : e.status === "on_notice" ? "warn" : "off"}>{STATUS_LABEL[e.status]}</Status></td>
              </tr>
            ))}
          </Table>
        ) : <Empty>{q || dept ? "No employees match." : "No employees yet."}</Empty>}
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
