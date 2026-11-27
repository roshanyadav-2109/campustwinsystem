"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R = { ok: true; message?: string } | { ok: false; error: string };
const clean = (e: { message: string }, f: string) => (e.message.length < 160 && !e.message.includes("violates") ? e.message : f);
async function rpc(name: string, args: Record<string, unknown>, paths: string[], done: (d: unknown) => string, fail: string): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) return { ok: false, error: clean(error, fail) };
  paths.forEach((p) => revalidatePath(p));
  return { ok: true, message: done(data) };
}

export async function addRoom(name: string, capacity: string): Promise<R> {
  if (!name.trim() || !/^\d{1,4}$/.test(capacity.trim())) return { ok: false, error: "Give the room a name and the number of seats." };
  const supabase = await createClient();
  const { error } = await supabase.from("exam_room" as never).insert({ name: name.trim().slice(0, 40), capacity: Number(capacity) } as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "A room with this name exists." : clean(error, "Could not add the room.") };
  revalidatePath("/dashboard/seating");
  return { ok: true, message: "Room added." };
}
export async function setRoomActive(id: number, active: boolean): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.from("exam_room" as never).update({ active } as never).eq("id", id);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath("/dashboard/seating");
  return { ok: true, message: active ? "In use." : "Not in use." };
}
export const generateSeating = async (sessionId: number) => rpc("generate_seating", { p_session: sessionId }, ["/dashboard/seating"], (d) => `${Number(d ?? 0)} candidates seated.`, "Could not plan the seating.");
export const assignDuties = async (sessionId: number, perRoom: number) => rpc("assign_duties", { p_session: sessionId, p_per_room: perRoom }, ["/dashboard/seating"], (d) => `${Number(d ?? 0)} duties assigned.`, "Could not assign duties.");
type ChartRow = { exam_date: string; starts_at: string; room: string; seat_no: number; student_name: string; admission_no: string; invigilators: string | null };
export async function seatingChart(sessionId: number) {
  const supabase = await createClient();
  const out: ChartRow[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await supabase.rpc("seating_chart" as never, { p_session: sessionId } as never).range(from, from + 999);
    const rows = (data ?? []) as unknown as ChartRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
export const generateScripts = async (paperId: number) => rpc("generate_scripts", { p_paper: paperId }, ["/dashboard/scripts"], (d) => `${Number(d ?? 0)} scripts coded.`, "Could not code the scripts.");
export const allotEvaluators = async (paperId: number, staff: number[]) => rpc("allot_evaluators", { p_paper: paperId, p_staff: staff }, ["/dashboard/scripts"], (d) => `${Number(d ?? 0)} scripts allotted.`, "Could not allot.");
export const decodeScripts = async (paperId: number) => rpc("decode_scripts", { p_paper: paperId }, ["/dashboard/scripts"], (d) => `${Number(d ?? 0)} marks decoded into the records.`, "Could not decode.");
export async function saveScriptMarks(rows: { id: number; marks: string; absent: boolean }[]): Promise<R> {
  for (const r of rows) if (!r.absent && r.marks.trim() && !/^\d{1,3}(\.\d{1,2})?$/.test(r.marks.trim())) return { ok: false, error: "Marks are numbers." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_script_marks" as never, { p_ids: rows.map((r) => r.id), p_marks: rows.map((r) => (r.absent || !r.marks.trim() ? null : Number(r.marks))), p_absent: rows.map((r) => r.absent) } as never);
  if (error) return { ok: false, error: clean(error, "Could not save.") };
  revalidatePath("/dashboard/scripts");
  const saved = Number(data ?? 0), skipped = rows.length - saved;
  return skipped ? { ok: false, error: `Saved ${saved}; ${skipped} not saved (above the paper maximum).` } : { ok: true, message: `Saved ${saved}.` };
}
export const signCia = async (semesterId: number, sectionId: number, subjectId: number, undo = false) =>
  rpc("sign_cia", { p_semester: semesterId, p_section: sectionId, p_subject: subjectId, p_undo: undo }, ["/dashboard"], () => (undo ? "Sign-off removed." : "Signed off."), "Could not sign off.");
export const setCiaRequired = async (required: boolean) =>
  rpc("set_cia_signoff_required", { p_required: required }, ["/dashboard/settings/evaluation"], () => "Saved.", "Could not save.");

export async function sessionSeats(sessionId: number, studentId?: number) {
  const supabase = await createClient();
  const out: { student_id: number; exam_date: string; starts_at: string; room: string; seat_no: number }[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await supabase.rpc("session_seats" as never, { p_session: sessionId, p_student: studentId ?? null } as never).range(from, from + 999);
    const rows = (data ?? []) as unknown as typeof out;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
export async function roomRoster(sessionId: number, date: string, start: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_room_roster" as never, { p_session: sessionId, p_date: date, p_start: start } as never);
  return (data ?? []) as unknown as { seat_id: number; seat_no: number; student_name: string; admission_no: string; room: string; present: boolean | null }[];
}
export async function markExamAttendance(seats: number[], present: boolean[]): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_exam_attendance" as never, { p_seats: seats, p_present: present } as never);
  if (error) return { ok: false, error: clean(error, "Could not save attendance.") };
  revalidatePath("/dashboard/invigilation");
  return { ok: true, message: `Attendance saved for ${Number(data ?? 0)}.` };
}
export async function reportIncident(seatId: number, description: string): Promise<R> {
  if (description.trim().length < 3) return { ok: false, error: "Describe what happened." };
  return rpc("report_incident", { p_seat: seatId, p_description: description.trim() }, ["/dashboard/invigilation", "/dashboard/exam-cell"], () => "Reported to the exam cell. The result is held until it is decided.", "Could not report.");
}
export const decideIncident = async (id: number, status: "cleared" | "penalised", decision: string) =>
  rpc("decide_incident", { p_id: id, p_status: status, p_decision: decision }, ["/dashboard/exam-cell"], () => (status === "cleared" ? "Cleared; the result is released." : "Penalty recorded."), "Could not save.");
