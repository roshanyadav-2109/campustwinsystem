"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentYear, getSession } from "@/lib/session";

// Admissions, Selection: seats, scores, application fee, test / interview
// slots and applicant documents (private storage). Office writes; the
// database checks seats and slot capacity.
type R = { ok: true; message?: string } | { ok: false; error: string };
const PATH = "/dashboard/admissions/selection";
const office = async () => { const s = await getSession(); return s?.staffRole === "office" ? s : null; };
const DOC_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

export async function setSeats(classId: number, seats: string): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change seats." };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No current year." };
  const supabase = await createClient();
  if (seats.trim() === "") {
    await supabase.from("admission_seat" as never).delete().eq("academic_year_id", year.id).eq("class_id", classId);
  } else {
    if (!/^\d{1,4}$/.test(seats.trim())) return { ok: false, error: "Seats must be a whole number." };
    const { error } = await supabase.from("admission_seat" as never).upsert({ academic_year_id: year.id, class_id: classId, seats: Number(seats) } as never, { onConflict: "academic_year_id,class_id" });
    if (error) return { ok: false, error: "Could not save." };
  }
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

export async function saveApplicant(id: number, input: { score: string; scoreNote: string; fee: string; feeOn: string; feeRef: string; slotId: number | null }): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change this." };
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  if ((input.score.trim() && !/^\d{1,4}(\.\d{1,2})?$/.test(input.score.trim())) || (input.fee.trim() && !/^\d{1,6}(\.\d{1,2})?$/.test(input.fee.trim()))) return { ok: false, error: "Score and fee must be numbers." };
  if (input.feeOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.feeOn)) return { ok: false, error: "Choose the date the fee was paid." };
  const supabase = await createClient();
  const { error } = await supabase.from("admission_enquiry").update({
    score: num(input.score), score_note: input.scoreNote.trim().slice(0, 200) || null,
    app_fee_amount: num(input.fee), app_fee_paid_on: input.feeOn || null, app_fee_ref: input.feeRef.trim().slice(0, 80) || null,
  } as never).eq("id", id);
  if (error) return { ok: false, error: "Could not save." };
  // test / interview slot
  const { data: slot } = input.slotId ? await supabase.from("admission_slot" as never).select("kind").eq("id", input.slotId).maybeSingle() : { data: null };
  const kind = (slot as { kind: string } | null)?.kind;
  if (input.slotId && kind) {
    await supabase.from("admission_booking" as never).delete().eq("enquiry_id", id).eq("kind", kind);
    const { error: bErr } = await supabase.from("admission_booking" as never).insert({ slot_id: input.slotId, enquiry_id: id, kind } as never);
    if (bErr) return { ok: false, error: bErr.message.includes("full") ? "That slot is full. Choose another." : "Could not book the slot." };
  }
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

export async function addSlot(input: { kind: "test" | "interview"; classId: number | null; startsAt: string; venue: string; capacity: string }): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can add slots." };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No current year." };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.startsAt)) return { ok: false, error: "Choose the date and time." };
  if (!/^\d{1,4}$/.test(input.capacity) || Number(input.capacity) < 1) return { ok: false, error: "Give how many children the slot takes." };
  const supabase = await createClient();
  const { error } = await supabase.from("admission_slot" as never).insert({
    academic_year_id: year.id, class_id: input.classId, kind: input.kind, starts_at: `${input.startsAt}:00+05:30`, venue: input.venue.trim().slice(0, 80) || null, capacity: Number(input.capacity),
  } as never);
  if (error) return { ok: false, error: "Could not add the slot." };
  revalidatePath(PATH);
  return { ok: true, message: "Slot added." };
}

export async function signAdmissionDoc(enquiryId: number, contentType: string, size: number): Promise<{ ok: true; key: string; uploadUrl: string } | { ok: false; error: string }> {
  const s = await office();
  if (!s) return { ok: false, error: "Only the office can upload documents." };
  if (!DOC_TYPES[contentType]) return { ok: false, error: "Upload a PDF, JPG or PNG." };
  if (size > 10 * 1024 * 1024) return { ok: false, error: "The file is over 10 MB." };
  const supabase = await createClient();
  const { data: e } = await supabase.from("admission_enquiry").select("id").eq("id", enquiryId).maybeSingle();
  if (!e) return { ok: false, error: "Unknown applicant." };
  const { presignPrivatePut, tenantPrefixForSchool } = await import("@/lib/r2");
  const key = `${await tenantPrefixForSchool(s.schoolId)}/admissions/${enquiryId}/${crypto.randomUUID()}.${DOC_TYPES[contentType]}`;
  return { ok: true, key, uploadUrl: await presignPrivatePut(key) };
}

export async function recordAdmissionDoc(enquiryId: number, kind: string, key: string): Promise<R> {
  const s = await office();
  if (!s) return { ok: false, error: "Only the office can upload documents." };
  if (!key.includes(`/admissions/${enquiryId}/`) || !kind.trim()) return { ok: false, error: "Could not save the document." };
  const supabase = await createClient();
  const { error } = await supabase.from("admission_document" as never).insert({ enquiry_id: enquiryId, kind: kind.trim().slice(0, 60), file_key: key, uploaded_by: s.staffId } as never);
  if (error) return { ok: false, error: "Could not save the document." };
  revalidatePath(PATH);
  return { ok: true, message: "Document saved." };
}

export async function admissionDocLink(docId: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || (s.staffRole !== "office" && s.staffRole !== "principal")) return { ok: false, error: "Not allowed." };
  const supabase = await createClient();
  const { data } = await supabase.from("admission_document" as never).select("file_key").eq("id", docId).maybeSingle();
  const key = (data as { file_key: string } | null)?.file_key;
  if (!key) return { ok: false, error: "Not found." };
  const { presignGet } = await import("@/lib/r2");
  return { ok: true, url: await presignGet(key) };
}
