import { requireApprover } from "@/lib/context";
import { fmtDate, LEAVE_STATUS_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputCls, btnPrimary, btnGhost, Status } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { decideLeave } from "../actions";

export const metadata = { title: "Approvals" };

const TONE = { pending: "warn", approved: "ok", rejected: "bad", cancelled: "off" } as const;

export default async function Approvals() {
  const { db, org, employeeId } = await requireApprover();

  // Row security already limits this to requests the person may see: everyone's
  // for HR admins, direct reports' for managers, plus their own.
  const [pending, recent, types] = await Promise.all([
    db.from("leave_request").select("id, employee_id, leave_type_id, from_date, to_date, days, reason, created_at")
      .eq("org_id", org.id).eq("status", "pending").order("from_date").limit(200),
    db.from("leave_request").select("id, employee_id, leave_type_id, from_date, to_date, days, status, decision_note")
      .eq("org_id", org.id).neq("status", "pending").order("decided_at", { ascending: false, nullsFirst: false }).limit(25),
    db.from("leave_type").select("id, name").eq("org_id", org.id),
  ]);
  const ids = [...new Set([...(pending.data ?? []), ...(recent.data ?? [])].map((r) => r.employee_id))];
  const { data: people } = ids.length ? await db.from("employee").select("id, full_name, code").in("id", ids) : { data: [] };
  const who = new Map((people ?? []).map((p) => [p.id, p]));
  const typeName = new Map((types.data ?? []).map((t) => [t.id, t.name]));
  const others = (pending.data ?? []).filter((r) => r.employee_id !== employeeId);

  return (
    <div>
      <PageHeader title="Approvals" sub="Leave requests waiting for a decision" />

      <div className="mb-4">
        <Section title="Waiting" desc={others.length ? `${others.length} request${others.length === 1 ? "" : "s"}` : undefined} flush>
          {others.length ? (
            <ul className="divide-y divide-cx-line">
              {others.map((r) => (
                <li key={r.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-cx-text">{who.get(r.employee_id)?.full_name ?? "Employee"} <span className="font-normal text-cx-faint">{who.get(r.employee_id)?.code}</span></p>
                    <p className="text-[13.5px] text-cx-text-2">
                      {typeName.get(r.leave_type_id)}, {fmtDate(r.from_date)}{r.to_date !== r.from_date && ` to ${fmtDate(r.to_date)}`} ({Number(r.days)} day{Number(r.days) === 1 ? "" : "s"})
                    </p>
                    <p className="mt-0.5 text-[13px] text-cx-muted">{r.reason}</p>
                  </div>
                  <ActionForm action={decideLeave} className="flex flex-wrap items-start gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <label htmlFor={`note-${r.id}`} className="sr-only">Note</label>
                    <input id={`note-${r.id}`} name="note" placeholder="Note (optional)" maxLength={500} className={`${inputCls} min-w-0 flex-1`} />
                    <button name="decision" value="approve" className={btnPrimary}>Approve</button>
                    <button name="decision" value="reject" className={btnGhost}>Decline</button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : <Empty>Nothing is waiting for you.</Empty>}
        </Section>
      </div>

      <Section title="Recently decided" flush>
        {recent.data?.length ? (
          <Table head={[{ label: "Employee" }, { label: "Leave" }, { label: "Status" }]}>
            {recent.data.map((r) => (
              <tr key={r.id}>
                <td className={td}><span className="text-cx-text">{who.get(r.employee_id)?.full_name ?? "Employee"}</span></td>
                <td className={td}>{typeName.get(r.leave_type_id)}, {fmtDate(r.from_date)}{r.to_date !== r.from_date && ` to ${fmtDate(r.to_date)}`}</td>
                <td className={td}>
                  <Status tone={TONE[r.status as keyof typeof TONE] ?? "off"}>{LEAVE_STATUS_LABEL[r.status] ?? r.status}</Status>
                  {r.decision_note && <div className="text-[12.5px] text-cx-muted">{r.decision_note}</div>}
                </td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No decisions yet.</Empty>}
      </Section>
    </div>
  );
}
