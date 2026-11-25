import { requireAdmin } from "@/lib/context";
import { todayIST, fmtDays } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputCls, inputBase, labelCls, btnPrimary, btnGhost, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { addLeaveType, toggleLeaveType, seedLeaveTypes, allocateYear } from "../../actions";

export const metadata = { title: "Leave policy" };

export default async function LeavePolicy() {
  const { db, org } = await requireAdmin();
  const year = Number(todayIST().slice(0, 4));
  const { data: types } = await db.from("leave_type").select("id, code, name, annual_quota, is_paid, active").eq("org_id", org.id).order("name");

  return (
    <div>
      <PageHeader title="Leave policy" sub="Leave types and the yearly allocation" />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Leave types" flush>
          {types?.length ? (
            <Table head={[{ label: "Type" }, { label: "Per year", right: true }, { label: "Status" }, { label: "" }]}>
              {types.map((t) => (
                <tr key={t.id}>
                  <td className={td}><span className="font-medium text-cx-text">{t.name}</span> <span className="text-cx-faint">{t.code}</span>{!t.is_paid && <div className="text-[12.5px] text-cx-muted">Unpaid, no balance needed</div>}</td>
                  <td className={`${td} text-right tabular-nums`}>{t.is_paid ? fmtDays(Number(t.annual_quota)) : ""}</td>
                  <td className={td}><Status tone={t.active ? "ok" : "off"}>{t.active ? "In use" : "Off"}</Status></td>
                  <td className={`${td} text-right`}>
                    <ActionForm action={toggleLeaveType}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={t.active ? "0" : "1"} />
                      <Submit className={btnGhost}>{t.active ? "Turn off" : "Turn on"}</Submit>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="px-5 py-8 text-center">
              <Empty>No leave types yet.</Empty>
              <ActionForm action={seedLeaveTypes}>
                <Submit className={btnPrimary} pending="Adding">Add casual, sick, earned and unpaid leave</Submit>
              </ActionForm>
            </div>
          )}
        </Section>

        <div className="space-y-4">
          <Section title={`Yearly allocation, ${year}`}>
            <p className="mb-3 text-[13.5px] text-cx-text-2">Gives every current employee the yearly days of each paid leave type. People who already have this year&apos;s allocation are skipped, so it is safe to run again after adding new employees.</p>
            <ActionForm action={allocateYear} className="flex items-center gap-2">
              <label htmlFor="year" className="sr-only">Year</label>
              <select id="year" name="year" defaultValue={year} className={`${inputBase} w-auto`}>
                <option value={year}>{year}</option>
                <option value={year + 1}>{year + 1}</option>
              </select>
              <Submit className={btnPrimary} pending="Allocating">Allocate</Submit>
            </ActionForm>
          </Section>

          <Section title="Add a leave type">
            <ActionForm action={addLeaveType} reset className="space-y-3">
              <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
                <div>
                  <label htmlFor="code" className={labelCls}>Code</label>
                  <input id="code" name="code" required maxLength={10} placeholder="ML" className={`${inputCls} uppercase`} />
                </div>
                <div>
                  <label htmlFor="name" className={labelCls}>Name</label>
                  <input id="name" name="name" required maxLength={80} placeholder="Maternity leave" className={inputCls} />
                </div>
              </div>
              <div>
                <label htmlFor="annual_quota" className={labelCls}>Days per year</label>
                <input id="annual_quota" name="annual_quota" type="number" min={0} max={366} step="0.5" defaultValue={0} className={inputCls} />
              </div>
              <label className="flex items-center gap-2 text-[13.5px] text-cx-text-2">
                <input type="checkbox" name="is_paid" defaultChecked className="h-4 w-4 accent-cx-text" /> Paid leave (uses a balance)
              </label>
              <Submit className={btnGhost} pending="Adding">Add leave type</Submit>
            </ActionForm>
          </Section>
        </div>
      </div>
    </div>
  );
}
