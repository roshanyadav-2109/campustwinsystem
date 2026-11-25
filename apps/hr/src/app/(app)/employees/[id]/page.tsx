import { notFound } from "next/navigation";
import { requireApprover } from "@/lib/context";
import { todayIST, fmtDate, fmtDays, employmentLabel, STATUS_LABEL, LEAVE_STATUS_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputCls, labelCls, btnPrimary, btnGhost, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { EmployeeFields } from "@/components/employee-fields";
import { updateEmployee, adjustLeave } from "../../actions";

export const metadata = { title: "Employee" };

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }) {
  const { db, org, isAdmin } = await requireApprover();
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const id = Number(raw);
  const added = (await searchParams).added === "1";
  const year = Number(todayIST().slice(0, 4));

  // Row security returns nothing for someone this person may not see.
  const { data: e } = await db.from("employee").select("*").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (!e) notFound();

  const [depts, desigs, people, types, balances, requests] = await Promise.all([
    db.from("department").select("id, name").eq("org_id", org.id).order("name"),
    db.from("designation").select("id, name").eq("org_id", org.id).order("name"),
    db.from("employee").select("id, full_name").eq("org_id", org.id).neq("status", "left").neq("id", id).order("full_name"),
    db.from("leave_type").select("id, name, is_paid").eq("org_id", org.id).order("name"),
    db.from("leave_balance").select("leave_type_id, balance").eq("employee_id", id).eq("year", year),
    db.from("leave_request").select("id, leave_type_id, from_date, to_date, days, status").eq("employee_id", id).order("from_date", { ascending: false }).limit(10),
  ]);
  const bal = new Map((balances.data ?? []).map((b) => [b.leave_type_id, Number(b.balance ?? 0)]));
  const typeName = new Map((types.data ?? []).map((t) => [t.id, t.name]));
  const managerName = e.manager_id ? (people.data ?? []).find((p) => p.id === e.manager_id)?.full_name : null;

  return (
    <div>
      <PageHeader title={e.full_name} sub={`${e.code}, ${employmentLabel(e.employment_type)}${managerName ? `, reports to ${managerName}` : ""}`}>
        <Status tone={e.status === "active" ? "ok" : e.status === "on_notice" ? "warn" : "off"}>{STATUS_LABEL[e.status]}</Status>
      </PageHeader>
      {added && <p role="status" className="mb-3 text-[13.5px] text-cx-ok">Employee added.{e.user_id ? " Their login is linked, so they can open HR now." : e.email ? " They can open HR once they sign in with this email." : ""}</p>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {isAdmin ? (
            <Section title="Details">
              <ActionForm action={updateEmployee} className="space-y-5">
                <input type="hidden" name="id" value={e.id} />
                <EmployeeFields
                  v={e}
                  departments={depts.data ?? []}
                  designations={desigs.data ?? []}
                  managers={(people.data ?? []).map((p) => ({ id: p.id, name: p.full_name }))}
                />
                <div className="grid gap-4 border-t border-cx-line pt-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="status" className={labelCls}>Status</label>
                    <select id="status" name="status" defaultValue={e.status} className={inputCls}>
                      <option value="active">Active</option>
                      <option value="on_notice">On notice</option>
                      <option value="left">Left</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="date_of_leaving" className={labelCls}>Date of leaving</label>
                    <input id="date_of_leaving" name="date_of_leaving" type="date" defaultValue={e.date_of_leaving ?? ""} className={inputCls} />
                  </div>
                </div>
                <Submit className={btnPrimary}>Save changes</Submit>
              </ActionForm>
            </Section>
          ) : (
            <Section title="Details">
              <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">
                {[["Email", e.email], ["Phone", e.phone], ["Joined", fmtDate(e.date_of_joining)]].map(([k, v]) => (
                  <div key={k}><dt className="text-[12.5px] text-cx-muted">{k}</dt><dd className="text-cx-text">{v || "Not given"}</dd></div>
                ))}
              </dl>
            </Section>
          )}

          <Section title="Recent leave" flush>
            {requests.data?.length ? (
              <Table head={[{ label: "Dates" }, { label: "Type" }, { label: "Days", right: true }, { label: "Status" }]}>
                {requests.data.map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} text-cx-text`}>{fmtDate(r.from_date)}{r.to_date !== r.from_date && ` to ${fmtDate(r.to_date)}`}</td>
                    <td className={td}>{typeName.get(r.leave_type_id)}</td>
                    <td className={`${td} text-right tabular-nums`}>{Number(r.days)}</td>
                    <td className={td}>{LEAVE_STATUS_LABEL[r.status]}</td>
                  </tr>
                ))}
              </Table>
            ) : <Empty>No leave taken yet.</Empty>}
          </Section>
        </div>

        <Section title={`Leave balance, ${year}`} flush>
          {types.data?.length ? (
            <ul className="divide-y divide-cx-line">
              {types.data.filter((t) => t.is_paid).map((t) => (
                <li key={t.id} className="flex items-center justify-between px-5 py-2.5 text-[14px]">
                  <span className="text-cx-text">{t.name}</span>
                  <span className="tabular-nums text-cx-text-2">{fmtDays(bal.get(t.id) ?? 0)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No leave types yet.</Empty>}
          {isAdmin && !!types.data?.length && (
            <div className="border-t border-cx-line p-5">
              <p className="mb-2 text-[13px] font-medium text-cx-text">Adjust balance</p>
              <ActionForm action={adjustLeave} reset className="space-y-2.5">
                <input type="hidden" name="employee_id" value={e.id} />
                <input type="hidden" name="year" value={year} />
                <label htmlFor="adj-type" className="sr-only">Leave type</label>
                <select id="adj-type" name="leave_type_id" className={inputCls} defaultValue="">
                  <option value="" disabled>Leave type</option>
                  {types.data.filter((t) => t.is_paid).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <label htmlFor="adj-days" className="sr-only">Days</label>
                  <input id="adj-days" name="days" type="number" step="0.5" placeholder="Days, e.g. 2 or -1" className={inputCls} />
                </div>
                <label htmlFor="adj-note" className="sr-only">Reason</label>
                <input id="adj-note" name="note" maxLength={300} placeholder="Reason" className={inputCls} />
                <Submit className={btnGhost}>Adjust</Submit>
              </ActionForm>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
