import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { StaffRegister, StaffMonth, type RegisterRow, type MonthRow } from "@/components/attendance/staff-attendance";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// Staff attendance (office and principal): the day's register and the month's totals.
export default async function StaffAttendancePage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/staff-attendance");
  if (denied) return denied;
  const sp = await searchParams;
  const view = one(sp.view) === "month" ? "month" : "day";
  const today = todayIST();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.date) ?? "") && (one(sp.date) as string) <= today ? (one(sp.date) as string) : today;
  const month = /^\d{4}-\d{2}$/.test(one(sp.month) ?? "") ? (one(sp.month) as string) : today.slice(0, 7);
  const supabase = await createClient();
  const tab = (v: string, label: string, href: string) => (
    <Link href={href} className={`rounded-sm border px-2.5 py-1 text-[13px] ${view === v ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700 hover:bg-panel"}`}>{label}</Link>
  );
  let body;
  if (view === "day") {
    const { data } = await supabase.rpc("staff_attendance_register" as never, { p_date: date } as never);
    body = <StaffRegister key={date} date={date} today={today} rows={(data ?? []) as unknown as RegisterRow[]} />;
  } else {
    const { data } = await supabase.rpc("staff_attendance_month" as never, { p_month: `${month}-01` } as never);
    body = <StaffMonth month={month} rows={(data ?? []) as unknown as MonthRow[]} />;
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Staff attendance" description="Mark staff attendance each day. Approved leave and holidays are filled in for you; the month's totals are ready for payroll." />
      <div className="flex gap-1.5">{tab("day", "Day register", `?view=day&date=${date}`)}{tab("month", "Month totals", `?view=month&month=${month}`)}</div>
      {body}
    </div>
  );
}
