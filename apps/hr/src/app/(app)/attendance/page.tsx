import { redirect } from "next/navigation";
import { getCtx } from "@/lib/context";
import { todayIST, fmtShort, fmtTime, ATTENDANCE_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, Kpi, kpiStrip, btnPrimary, btnGhost } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { checkIn, checkOut } from "../actions";

export const metadata = { title: "Attendance" };

export default async function MyAttendance() {
  const { db, org, employeeId } = await getCtx();
  if (!employeeId) redirect("/home");
  const today = todayIST();
  const monthStart = today.slice(0, 8) + "01";

  const [rows, holidays] = await Promise.all([
    db.from("attendance").select("day, check_in, check_out, status").eq("employee_id", employeeId).gte("day", monthStart).order("day", { ascending: false }),
    db.from("holiday").select("day, name").eq("org_id", org.id).gte("day", today).order("day").limit(5),
  ]);
  const list = rows.data ?? [];
  const todayRow = list.find((r) => r.day === today);
  const present = list.filter((r) => r.status === "present").length + list.filter((r) => r.status === "half_day").length / 2;
  const month = new Date(today + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <PageHeader title="Attendance" sub={month}>
        {!todayRow?.check_in && <ActionForm action={checkIn}><Submit className={btnPrimary} pending="Checking in">Check in</Submit></ActionForm>}
        {todayRow?.check_in && !todayRow.check_out && <ActionForm action={checkOut}><Submit className={btnGhost} pending="Checking out">Check out</Submit></ActionForm>}
      </PageHeader>

      <div className={kpiStrip}>
        <Kpi label="Days present this month" value={present} />
        <Kpi label="Today" value={todayRow?.check_in ? fmtTime(todayRow.check_in) : "Not checked in"} sub={todayRow?.check_out ? `out at ${fmtTime(todayRow.check_out)}` : undefined} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title="This month" flush>
          {list.length ? (
            <Table head={[{ label: "Day" }, { label: "Status" }, { label: "In" }, { label: "Out" }]}>
              {list.map((r) => (
                <tr key={r.day}>
                  <td className={`${td} text-cx-text`}>{fmtShort(r.day)}</td>
                  <td className={td}>{ATTENDANCE_LABEL[r.status] ?? r.status}</td>
                  <td className={`${td} tabular-nums`}>{fmtTime(r.check_in)}</td>
                  <td className={`${td} tabular-nums`}>{fmtTime(r.check_out)}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No attendance recorded this month yet.</Empty>}
        </Section>
        <Section title="Upcoming holidays" flush>
          {holidays.data?.length ? (
            <ul className="divide-y divide-cx-line">
              {holidays.data.map((h) => (
                <li key={h.day} className="px-5 py-2.5 text-[14px]">
                  <span className="text-cx-text">{h.name}</span>
                  <div className="text-[12.5px] text-cx-muted">{fmtShort(h.day)}</div>
                </li>
              ))}
            </ul>
          ) : <Empty>No holidays listed.</Empty>}
        </Section>
      </div>
    </div>
  );
}
