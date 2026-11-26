"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { downloadXlsx } from "@/lib/xlsx";
import { saveStaffAttendance } from "@/app/dashboard/staff-attendance/actions";

export type RegisterRow = { staff_id: number; full_name: string; role: string; status: string | null; in_time: string | null; out_time: string | null; note: string | null; on_leave: boolean; saved: boolean; holiday: string | null };
export type MonthRow = { staff_id: number; full_name: string; role: string; working_days: number; present: number; late: number; half_day: number; leave: number; absent: number; unmarked: number };

const STATUS = [
  { v: "present", l: "P", t: "Present" }, { v: "late", l: "Late", t: "Late" }, { v: "half_day", l: "½", t: "Half day" },
  { v: "leave", l: "L", t: "On leave" }, { v: "absent", l: "A", t: "Absent" },
];
const ROLE: Record<string, string> = { principal: "Principal", office: "Office", subject_teacher: "Teacher", class_teacher: "Class teacher", transport: "Transport" };

export function StaffRegister({ date, today, rows }: { date: string; today: string; rows: RegisterRow[] }) {
  const [marks, setMarks] = useState(() => Object.fromEntries(rows.map((r) => [r.staff_id, { status: r.status ?? "", inTime: r.in_time?.slice(0, 5) ?? "", outTime: r.out_time?.slice(0, 5) ?? "", note: r.note ?? "" }])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const holiday = rows.find((r) => r.holiday)?.holiday;
  const set = (id: number, patch: Partial<{ status: string; inTime: string; outTime: string; note: string }>) => setMarks((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const unsavedCount = rows.filter((r) => !r.saved).length;
  return (
    <Card>
      <CardHeader title="Day register" action={
        <div className="flex items-center gap-2">
          <Input type="date" className="h-8 w-40 text-[13px]" aria-label="Date" value={date} max={today} onChange={(e) => router.push(`?view=day&date=${e.target.value}`)} />
          <Button size="sm" variant="ghost" onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, status: v.status || "present" }])))}>Everyone else present</Button>
        </div>} />
      <CardBody className="p-0">
        {holiday && <p className="border-b border-hair bg-[#fafafa] px-4 py-2 text-[13px] text-ink-700">Holiday: {holiday}. Mark only those who came in.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="bg-[#fafafa] text-left text-ink-500"><tr>
              <th className="px-4 py-2 font-medium">Name</th><th className="px-2 py-2 font-medium">Role</th><th className="px-2 py-2 font-medium">Attendance</th>
              <th className="px-2 py-2 font-medium">In</th><th className="px-2 py-2 font-medium">Out</th><th className="px-2 py-2 font-medium">Note</th></tr></thead>
            <tbody>{rows.map((r) => {
              const m = marks[r.staff_id];
              return (
                <tr key={r.staff_id} className="border-t border-hair">
                  <td className="px-4 py-1.5 font-medium text-ink-900">{r.full_name}{r.on_leave && <span className="ml-2 text-[11px] font-normal text-ink-500">approved leave</span>}</td>
                  <td className="px-2 py-1.5 text-ink-700">{ROLE[r.role] ?? r.role}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1" role="radiogroup" aria-label={`${r.full_name} attendance`}>
                      {STATUS.map((s) => (
                        <button key={s.v} role="radio" aria-checked={m.status === s.v} aria-label={`${r.full_name}: ${s.t}`} title={s.t} onClick={() => set(r.staff_id, { status: s.v })}
                          className={`h-7 min-w-[34px] rounded-sm border px-1.5 text-[12px] font-semibold ${m.status === s.v ? (s.v === "absent" ? "border-down bg-down text-white" : "border-[#0F6CBD] bg-[#0F6CBD] text-white") : "border-hair bg-white text-ink-700"}`}>{s.l}</button>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5"><Input type="time" className="h-7 w-28 text-[12px]" aria-label={`${r.full_name}: in time`} value={m.inTime} onChange={(e) => set(r.staff_id, { inTime: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input type="time" className="h-7 w-28 text-[12px]" aria-label={`${r.full_name}: out time`} value={m.outTime} onChange={(e) => set(r.staff_id, { outTime: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input className="h-7 min-w-[160px] text-[12px]" aria-label={`${r.full_name}: note`} value={m.note} onChange={(e) => set(r.staff_id, { note: e.target.value })} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-hair px-4 py-2.5">
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await saveStaffAttendance(date, rows.map((x) => ({ staffId: x.staff_id, ...marks[x.staff_id] })));
            setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          })}>{pending ? "Saving…" : "Save register"}</Button>
          <span className="text-[12px] text-ink-500">{unsavedCount ? `${unsavedCount} not saved yet for this day.` : "All saved for this day."}</span>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
        </div>
      </CardBody>
    </Card>
  );
}

export function StaffMonth({ month, rows }: { month: string; rows: MonthRow[] }) {
  const router = useRouter();
  const headers = ["Name", "Role", "Working days", "Present", "Late", "Half day", "Leave", "Absent", "Not marked"];
  return (
    <Card>
      <CardHeader title="Month totals" action={
        <div className="flex items-center gap-2">
          <Input type="month" className="h-8 w-40 text-[13px]" aria-label="Month" value={month} onChange={(e) => router.push(`?view=month&month=${e.target.value}`)} />
          <Button size="sm" variant="subtle" onClick={() => downloadXlsx(`Staff attendance ${month}`, headers, rows.map((r) => [r.full_name, ROLE[r.role] ?? r.role, r.working_days, r.present, r.late, r.half_day, r.leave, r.absent, r.unmarked]), "Attendance")}>Download Excel</Button>
        </div>} />
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafafa] text-left text-ink-500"><tr>{headers.map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i > 1 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.staff_id} className="border-t border-hair">
                <td className="px-3 py-1.5 font-medium">{r.full_name}</td><td className="px-3 py-1.5">{ROLE[r.role] ?? r.role}</td>
                {[r.working_days, r.present, r.late, r.half_day, r.leave, r.absent, r.unmarked].map((n, i) => <td key={i} className={`px-3 py-1.5 text-right tabular ${i === 5 && n ? "text-down" : ""}`}>{n}</td>)}
              </tr>))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-hair px-4 py-2 text-[12px] text-ink-500">Working days leave out Sundays and the school&apos;s holidays.</p>
      </CardBody>
    </Card>
  );
}
