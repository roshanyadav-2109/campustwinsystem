"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/data/schedule";

type R = { ok: true; message?: string } | { ok: false; error: string };
const clean = (e: { message: string }, f: string) => (e.message.length < 160 && !e.message.includes("violates") ? e.message : f);
async function rpc(name: string, args: Record<string, unknown>, paths: string[], done: (d: unknown) => string, fail: string): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) return { ok: false, error: clean(error, fail) };
  paths.forEach((p) => revalidatePath(p));
  return { ok: true, message: done(data) };
}

export async function addRoom(name: string, capacity: string, layout?: { rows: string; benches: string; perBench: string }): Promise<R> {
  const byLayout = !!layout && /^\d{1,2}$/.test(layout.rows.trim()) && /^\d{1,2}$/.test(layout.benches.trim());
  if (!name.trim() || (!byLayout && !/^\d{1,4}$/.test(capacity.trim()))) return { ok: false, error: "Give the room a name and the number of seats (or rows and benches)." };
  const supabase = await createClient();
  const { error } = await supabase.from("exam_room" as never).insert({ name: name.trim().slice(0, 40), capacity: byLayout ? 1 : Number(capacity),
    rows_n: byLayout ? Number(layout!.rows) : null, benches_n: byLayout ? Number(layout!.benches) : null, per_bench: byLayout ? Math.min(Math.max(Number(layout!.perBench) || 1, 1), 3) : 1 } as never);
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
export const assignDuties = async (sessionId: number, perRoom: number) => rpc("assign_duties", { p_session: sessionId, p_per_room: perRoom }, ["/dashboard/seating"], (d) => { const x = d as { assigned: number; short: string | null }; return `${Number(x?.assigned ?? 0)} duties assigned.${x?.short ? ` Not enough free teachers on ${x.short}; some rooms are short.` : ""}`; }, "Could not assign duties.");
type ChartRow = { exam_date: string; starts_at: string; room: string; seat_no: number; seat_label: string; student_name: string; admission_no: string; invigilators: string | null; needs: string | null };
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
export const decodeScripts = async (paperId: number) => rpc("decode_scripts", { p_paper: paperId }, ["/dashboard/scripts"], (d) => { const x = d as { decoded: number; left: number; codes: string | null }; return `${Number(x?.decoded ?? 0)} marks decoded into the records.${x?.left ? ` ${x.left} could not be written (no marks column for the student, or the result is already published): ${x.codes ?? ""}.` : ""}`; }, "Could not decode.");
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

export async function sessionSeats(sessionId: number, studentId?: number, sectionId?: number) {
  const supabase = await createClient();
  const out: { student_id: number; exam_date: string; starts_at: string; room: string; seat_no: number; seat_label: string }[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await supabase.rpc("session_seats" as never, { p_session: sessionId, p_student: studentId ?? null, p_section: sectionId ?? null } as never).range(from, from + 999);
    const rows = (data ?? []) as unknown as typeof out;
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
export type RosterRow = { seat_id: number; seat_no: number; seat_label: string; student_name: string; admission_no: string; room: string; present: boolean | null; booklet_no: string | null; extra_sheets: number | null; late: boolean; needs: string | null };
export async function roomRoster(sessionId: number, date: string, start: string, roomId?: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_room_roster" as never, { p_session: sessionId, p_date: date, p_start: start, p_room: roomId ?? null } as never);
  return (data ?? []) as unknown as RosterRow[];
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
export type Penalty = "warning" | "cancel_paper" | "cancel_all" | "debar";
export const decideIncident = async (id: number, status: "cleared" | "penalised", decision: string, penalty?: Penalty) =>
  rpc("decide_incident", { p_id: id, p_status: status, p_decision: decision, p_penalty: penalty ?? null }, ["/dashboard/exam-cell"],
    () => (status === "cleared" ? "Cleared; the result is released." : penalty === "cancel_all" || penalty === "debar" ? "Penalty recorded; the result stays withheld." : "Penalty recorded."), "Could not save.");
export const setOwnTeacherEvaluation = async (on: boolean) =>
  rpc("set_own_teacher_evaluation", { p_on: on }, ["/dashboard/settings/evaluation"], () => (on ? "Teachers may value their own students' coded scripts." : "Teachers cannot value their own students' scripts."), "Could not save.");

export async function saveBooklets(rows: { seat: number; booklet: string; extra: number | null; late: boolean }[]): Promise<R> {
  if (rows.some((r) => r.booklet.length > 30 || (r.extra != null && (r.extra < 0 || r.extra > 40)))) return { ok: false, error: "A booklet number has at most 30 characters; extra sheets 0 to 40." };
  return rpc("save_booklets", { p_seats: rows.map((r) => r.seat), p_booklets: rows.map((r) => r.booklet), p_extra: rows.map((r) => r.extra), p_late: rows.map((r) => r.late) },
    ["/dashboard/invigilation"], (d) => `Booklets saved for ${Number(d ?? 0)}.`, "Could not save.");
}
export const swapDuty = async (dutyId: number, staffId: number) => rpc("swap_duty", { p_duty: dutyId, p_staff: staffId }, ["/dashboard/seating"], () => "Duty changed.", "Could not change the duty.");

export async function saveAccommodation(input: { admissionNo: string; sessionId: number | null; scribe: boolean; scribeName: string; extra: number; note: string }): Promise<R> {
  const supabase = await createClient();
  const { data: st } = await supabase.from("student").select("id").eq("admission_no", input.admissionNo.trim()).maybeSingle();
  if (!st) return { ok: false, error: "No student with that admission number." };
  if (!Number.isInteger(input.extra) || input.extra < 0 || input.extra > 120) return { ok: false, error: "Extra time is 0 to 120 minutes." };
  const db = await untyped();
  let q = db.from("exam_accommodation").delete().eq("student_id", st.id);
  q = input.sessionId ? q.eq("session_id", input.sessionId) : q.is("session_id", null);
  await q;
  const { error } = await db.from("exam_accommodation").insert({ student_id: st.id, session_id: input.sessionId, scribe: input.scribe, scribe_name: input.scribeName.trim().slice(0, 80) || null,
    extra_minutes: input.extra, note: input.note.trim().slice(0, 200) || null } as never);
  if (error) return { ok: false, error: clean(error, "Could not save.") };
  revalidatePath("/dashboard/seating");
  return { ok: true, message: "Saved. It shows on the room roster and the seating chart." };
}
export async function removeAccommodation(id: number): Promise<R> {
  const supabase = await createClient();
  const db = await untyped();
  const { error } = await db.from("exam_accommodation").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not remove." };
  revalidatePath("/dashboard/seating");
  return { ok: true, message: "Removed." };
}

export async function saveRates(duty: string, script: string): Promise<R> {
  if (![duty, script].every((v) => /^\d{1,6}(\.\d{1,2})?$/.test(v.trim() || "0"))) return { ok: false, error: "Rates are amounts in rupees." };
  const supabase = await createClient();
  const db = await untyped();
  const { error } = await db.from("exam_rate").upsert([{ kind: "duty", amount: Number(duty || 0) }, { kind: "script", amount: Number(script || 0) }] as never, { onConflict: "school_id,kind" });
  if (error) return { ok: false, error: clean(error, "Only the Controller of Examinations can set rates.") };
  revalidatePath("/dashboard/seating");
  return { ok: true, message: "Rates saved." };
}
export async function remuneration(sessionId: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("exam_remuneration" as never, { p_session: sessionId } as never);
  return (data ?? []) as unknown as { staff_id: number; staff_name: string; employee_code: string | null; duties: number; scripts: number; duty_amount: number; script_amount: number; total: number }[];
}

// A photocopy of the answer script: the exam cell uploads the scan; the student downloads it.
export async function signPhotocopy(requestId: number, contentType: string, size: number): Promise<{ ok: true; key: string; uploadUrl: string } | { ok: false; error: string }> {
  if (contentType !== "application/pdf" && !/^image\/(jpeg|png)$/.test(contentType)) return { ok: false, error: "Upload a PDF, JPG or PNG." };
  if (size > 20 * 1024 * 1024) return { ok: false, error: "The file is over 20 MB." };
  const supabase = await createClient();
  const { data: rq } = await supabase.from("reval_request" as never).select("id, student_id, kind").eq("id", requestId).maybeSingle();
  const r = rq as unknown as { id: number; student_id: number; kind: string } | null;
  if (!r || r.kind !== "photocopy") return { ok: false, error: "Unknown request." };
  const { getSession } = await import("@/lib/session");
  const s = await getSession();
  if (!s) return { ok: false, error: "Not allowed." };
  const { presignPrivatePut, tenantPrefixForSchool } = await import("@/lib/r2");
  const ext = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg";
  const key = `${await tenantPrefixForSchool(s.schoolId)}/students/${r.student_id}/scripts/${crypto.randomUUID()}.${ext}`;
  return { ok: true, key, uploadUrl: await presignPrivatePut(key) };
}
export async function supplyPhotocopy(requestId: number, key: string): Promise<R> {
  const { getSession } = await import("@/lib/session");
  const { tenantPrefixForSchool } = await import("@/lib/r2");
  const s = await getSession();
  if (!s || !key.startsWith(`${await tenantPrefixForSchool(s.schoolId)}/students/`)) return { ok: false, error: "Could not save the file." };
  return rpc("supply_photocopy", { p_id: requestId, p_key: key }, ["/dashboard/revaluation", "/dashboard/results"], () => "Photocopy supplied; the student can download it.", "Could not save.");
}
export async function photocopyLink(requestId: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data } = await supabase.from("reval_request" as never).select("file_key, status").eq("id", requestId).maybeSingle();
  const r = data as unknown as { file_key: string | null; status: string } | null;
  if (!r?.file_key || r.status !== "supplied") return { ok: false, error: "Not available yet." };
  const { presignGet } = await import("@/lib/r2");
  return { ok: true, url: await presignGet(r.file_key) };
}
export const setPhotocopyFee = async (fee: string) => rpc("set_photocopy_fee", { p_fee: fee.trim() ? Number(fee) : null }, ["/dashboard/settings/evaluation"], () => "Saved.", "Could not save.");
