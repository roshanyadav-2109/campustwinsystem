import { redirect } from "next/navigation";
import { getCtx } from "@/lib/context";
import { todayIST, fmtDate, fmtDays, LEAVE_STATUS_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputCls, labelCls, btnPrimary, btnGhost, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { applyLeave, cancelLeave } from "../actions";

export const metadata = { title: "My leave" };

const TONE = { pending: "warn", approved: "ok", rejected: "bad", cancelled: "off" } as const;

export default async function MyLeave() {
  const { db, org, employeeId } = await getCtx();
  if (!employeeId) redirect("/home");
  const today = todayIST();
  const year = Number(today.slice(0, 4));

  const [types, balances, requests] = await Promise.all([
    db.from("leave_type").select("id, code, name, is_paid").eq("org_id", org.id).eq("active", true).order("name"),
    db.from("leave_balance").select("leave_type_id, balance").eq("employee_id", employeeId).eq("year", year),
    db.from("leave_request").select("id, leave_type_id, from_date, to_date, days, reason, status, decision_note")
      .eq("employee_id", employeeId).order("from_date", { ascending: false }).limit(50),
  ]);
  const bal = new Map((balances.data ?? []).map((b) => [b.leave_type_id, Number(b.balance ?? 0)]));
  const typeName = new Map((types.data ?? []).map((t) => [t.id, t.name]));

  return (
    <div>
      <PageHeader title="My leave" sub={`Balances for ${year}`} />

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="Balance" flush>
          {types.data?.length ? (
            <Table head={[{ label: "Leave type" }, { label: "Days left", right: true }]}>
              {types.data.map((t) => (
                <tr key={t.id}>
                  <td className={td}><span className="font-medium text-cx-text">{t.name}</span> <span className="text-cx-faint">{t.code}</span></td>
                  <td className={`${td} text-right tabular-nums`}>{t.is_paid ? fmtDays(bal.get(t.id) ?? 0) : "Unpaid"}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>Your organisation has not set up leave types yet.</Empty>}
        </Section>

        <Section title="Apply for leave">
          <ActionForm action={applyLeave} reset className="space-y-3">
            <div>
              <label htmlFor="leave_type_id" className={labelCls}>Leave type</label>
              <select id="leave_type_id" name="leave_type_id" required className={inputCls} defaultValue="">
                <option value="" disabled>Choose</option>
                {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="from_date" className={labelCls}>First day</label>
                <input id="from_date" name="from_date" type="date" required className={inputCls} min={`${year - 1}-01-01`} />
              </div>
              <div>
                <label htmlFor="to_date" className={labelCls}>Last day</label>
                <input id="to_date" name="to_date" type="date" className={inputCls} min={`${year - 1}-01-01`} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[13.5px] text-cx-text-2">
              <input type="checkbox" name="half_day" className="h-4 w-4 accent-cx-text" /> Half day (one date only)
            </label>
            <div>
              <label htmlFor="reason" className={labelCls}>Reason</label>
              <textarea id="reason" name="reason" required maxLength={500} rows={2} className={inputCls} />
            </div>
            <Submit className={btnPrimary} pending="Sending">Send for approval</Submit>
          </ActionForm>
        </Section>
      </div>

      <Section title="My requests" flush>
        {requests.data?.length ? (
          <Table head={[{ label: "Dates" }, { label: "Type" }, { label: "Days", right: true }, { label: "Status" }, { label: "" }]}>
            {requests.data.map((r) => {
              const canCancel = r.status === "pending" || (r.status === "approved" && r.from_date > today);
              return (
                <tr key={r.id}>
                  <td className={td}>
                    <span className="text-cx-text">{fmtDate(r.from_date)}{r.to_date !== r.from_date && ` to ${fmtDate(r.to_date)}`}</span>
                    <div className="text-[12.5px] text-cx-muted">{r.reason}</div>
                  </td>
                  <td className={td}>{typeName.get(r.leave_type_id) ?? "Leave"}</td>
                  <td className={`${td} text-right tabular-nums`}>{Number(r.days)}</td>
                  <td className={td}>
                    <Status tone={TONE[r.status as keyof typeof TONE] ?? "off"}>{LEAVE_STATUS_LABEL[r.status] ?? r.status}</Status>
                    {r.decision_note && <div className="text-[12.5px] text-cx-muted">{r.decision_note}</div>}
                  </td>
                  <td className={`${td} text-right`}>
                    {canCancel && (
                      <ActionForm action={cancelLeave}>
                        <input type="hidden" name="id" value={r.id} />
                        <Submit className={btnGhost} pending="Cancelling">Cancel</Submit>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>No leave requests yet.</Empty>}
      </Section>
    </div>
  );
}
