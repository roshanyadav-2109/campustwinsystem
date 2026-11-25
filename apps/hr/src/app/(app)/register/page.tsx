import Link from "next/link";
import { requireApprover } from "@/lib/context";
import { todayIST, addDays, fmtShort, fmtTime, ATTENDANCE_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputBase, btnGhost, Kpi, kpiStrip } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { markAttendance } from "../actions";

export const metadata = { title: "Attendance register" };

export default async function Register({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { db, org, isAdmin } = await requireApprover();
  const today = todayIST();
  const asked = (await searchParams).day;
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;

  const [people, marks, leave, holiday] = await Promise.all([
    db.from("employee").select("id, code, full_name").eq("org_id", org.id).neq("status", "left").order("full_name"),
    db.from("attendance").select("employee_id, status, check_in, check_out, source").eq("org_id", org.id).eq("day", day),
    db.from("leave_request").select("employee_id").eq("org_id", org.id).eq("status", "approved").lte("from_date", day).gte("to_date", day),
    db.from("holiday").select("name").eq("org_id", org.id).eq("day", day).maybeSingle(),
  ]);
  const mark = new Map((marks.data ?? []).map((m) => [m.employee_id, m]));
  const onLeave = new Set((leave.data ?? []).map((l) => l.employee_id));
  const list = people.data ?? [];
  const present = (marks.data ?? []).filter((m) => m.status === "present" || m.status === "half_day").length;

  return (
    <div>
      <PageHeader title="Attendance register" sub={holiday.data ? `${fmtShort(day)}, holiday: ${holiday.data.name}` : fmtShort(day)}>
        <Link href={`/register?day=${addDays(day, -1)}`} className={btnGhost}>Previous day</Link>
        {day < today && <Link href={`/register?day=${addDays(day, 1)}`} className={btnGhost}>Next day</Link>}
        <form className="flex items-center gap-2">
          <label htmlFor="day" className="sr-only">Date</label>
          <input id="day" name="day" type="date" defaultValue={day} max={today} className={`${inputBase} w-auto`} />
          <button className={btnGhost}>Open</button>
        </form>
      </PageHeader>

      <div className={kpiStrip}>
        <Kpi label="Employees" value={list.length} />
        <Kpi label="Present" value={present} />
        <Kpi label="On approved leave" value={onLeave.size} />
        <Kpi label="Not marked" value={list.filter((p) => !mark.has(p.id) && !onLeave.has(p.id)).length} />
      </div>

      <Section flush>
        {list.length ? (
          <Table head={[{ label: "Employee" }, { label: "Status" }, { label: "In" }, { label: "Out" }, ...(isAdmin ? [{ label: "Mark" }] : [])]}>
            {list.map((p) => {
              const m = mark.get(p.id);
              const status = m ? ATTENDANCE_LABEL[m.status] ?? m.status : onLeave.has(p.id) ? "On approved leave" : "Not marked";
              return (
                <tr key={p.id}>
                  <td className={td}><span className="font-medium text-cx-text">{p.full_name}</span> <span className="text-cx-faint">{p.code}</span></td>
                  <td className={td}>{status}{m?.source === "self" && <span className="text-cx-faint">, self</span>}</td>
                  <td className={`${td} tabular-nums`}>{fmtTime(m?.check_in)}</td>
                  <td className={`${td} tabular-nums`}>{fmtTime(m?.check_out)}</td>
                  {isAdmin && (
                    <td className={td}>
                      <ActionForm action={markAttendance} className="flex items-center gap-2">
                        <input type="hidden" name="employee_id" value={p.id} />
                        <input type="hidden" name="day" value={day} />
                        <label htmlFor={`s-${p.id}`} className="sr-only">Status for {p.full_name}</label>
                        <select id={`s-${p.id}`} name="status" defaultValue={m?.status ?? (onLeave.has(p.id) ? "on_leave" : "present")} className={`${inputBase} w-auto py-1`}>
                          {Object.entries(ATTENDANCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          {m && <option value="clear">Clear</option>}
                        </select>
                        <Submit className={btnGhost} pending="Saving">Save</Submit>
                      </ActionForm>
                    </td>
                  )}
                </tr>
              );
            })}
          </Table>
        ) : <Empty>No employees yet.</Empty>}
      </Section>
    </div>
  );
}
