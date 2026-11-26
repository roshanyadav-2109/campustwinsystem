"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export type Result = { ok: true; message?: string } | { ok: false; error: string };
export type StaffMark = { staffId: number; status: string; inTime: string; outTime: string; note: string };
const STATUSES = new Set(["present", "absent", "half_day", "leave", "late"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// The office or principal saves the day's staff register (only rows with a status).
export async function saveStaffAttendance(date: string, marks: StaffMark[]): Promise<Result> {
  const s = await getSession();
  if (!s || (s.staffRole !== "office" && s.staffRole !== "principal")) return { ok: false, error: "Only the office or the principal can mark staff attendance." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Choose a date." };
  const rows = [];
  for (const m of marks.slice(0, 1000)) {
    if (!STATUSES.has(m.status)) continue;
    if ((m.inTime && !TIME.test(m.inTime)) || (m.outTime && !TIME.test(m.outTime))) return { ok: false, error: "Times must look like 09:05." };
    rows.push({ staff_id: m.staffId, on_date: date, status: m.status, in_time: m.inTime || null, out_time: m.outTime || null, note: m.note.trim().slice(0, 200) || null, marked_by: s.staffId });
  }
  if (!rows.length) return { ok: false, error: "Mark at least one person." };
  const supabase = await createClient();
  const { error } = await supabase.from("staff_attendance" as never).upsert(rows as never, { onConflict: "staff_id,on_date" });
  if (error) return { ok: false, error: error.message.includes("future") ? "Attendance cannot be marked for a future day." : "Could not save." };
  revalidatePath("/dashboard/staff-attendance");
  return { ok: true, message: `Saved for ${rows.length} staff.` };
}

export async function scanCard(token: string): Promise<{ ok: boolean; message: string; student: string | null; cls: string | null; status: string | null; photo?: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("scan_student_card" as never, { p_token: token.slice(0, 300) } as never);
  if (error) return { ok: false, message: error.message.includes("Only the office") ? "You cannot scan cards." : "Could not read the card.", student: null, cls: null, status: null };
  const r = ((data ?? []) as unknown as { ok: boolean; message: string; student_name: string | null; class_label: string | null; status: string | null; photo: string | null }[])[0];
  revalidatePath("/dashboard/attendance");
  return r ? { ok: r.ok, message: r.message, student: r.student_name, cls: r.class_label, status: r.status, photo: r.photo } : { ok: false, message: "Could not read the card.", student: null, cls: null, status: null };
}
