"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { untyped } from "@/lib/data/schedule";
import type { StudentIdentity, StudentProfile } from "@/lib/data/student-record";

// Saving a student's profile. The database's row rules decide who may write
// (office and principal; a class teacher for the everyday profile of their own
// class); these checks give a clear message first.

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const TRY_AGAIN = "That could not be saved. Please try again.";
const isId = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "") || null;
const isDate = (v: string | null) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)));
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const CATEGORY = ["general", "sc", "st", "obc", "ews"];
const MINORITY = ["none", "muslim", "christian", "sikh", "buddhist", "parsi", "jain"];
const STREAM = ["science", "commerce", "humanities", "vocational"];
const PREV = ["promoted", "passed", "failed", "detained", "new"];
const FACILITIES = ["free_textbooks", "free_uniform", "free_transport", "free_escort", "free_hostel", "free_bicycle", "free_laptop", "scholarship", "mid_day_meal"];
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function saveStudentProfile(studentId: number, input: Partial<StudentProfile>): Promise<Result> {
  const session = await getSession();
  if (!session?.staffId) return fail("Only school staff can change a student's details.");
  if (!isId(studentId)) return fail(TRY_AGAIN);
  const row = {
    admission_date: clean(input.admission_date, 10), admitted_class: clean(input.admitted_class, 40),
    previous_school: clean(input.previous_school, 160), mother_tongue: clean(input.mother_tongue, 40),
    nationality: clean(input.nationality, 40), place_of_birth: clean(input.place_of_birth, 80),
    blood_group: clean(input.blood_group, 3), house: clean(input.house, 40),
    address_line: clean(input.address_line, 240), city: clean(input.city, 80), state: clean(input.state, 60),
    pincode: clean(input.pincode, 6), allergies: clean(input.allergies, 300), medical_notes: clean(input.medical_notes, 500),
    emergency_name: clean(input.emergency_name, 80), emergency_phone: clean(input.emergency_phone, 20),
    mother_name: clean(input.mother_name, 100), father_name: clean(input.father_name, 100),
    height_cm: num(input.height_cm), weight_kg: num(input.weight_kg), medium: clean(input.medium, 40), stream: clean(input.stream, 12),
    prev_result: clean(input.prev_result, 10), prev_percent: num(input.prev_percent), prev_attendance_days: num(input.prev_attendance_days),
    facilities: (input.facilities ?? []).filter((x) => FACILITIES.includes(x)),
  };
  if (row.height_cm != null && !(row.height_cm >= 40 && row.height_cm <= 250)) return fail("Height is in centimetres, between 40 and 250.");
  if (row.weight_kg != null && !(row.weight_kg >= 5 && row.weight_kg <= 200)) return fail("Weight is in kilograms, between 5 and 200.");
  if (row.stream && !STREAM.includes(row.stream)) return fail("Choose a stream from the list.");
  if (row.prev_result && !PREV.includes(row.prev_result)) return fail("Choose last year's result from the list.");
  if (row.prev_percent != null && !(row.prev_percent >= 0 && row.prev_percent <= 100)) return fail("Last year's percentage is between 0 and 100.");
  if (row.prev_attendance_days != null && !(Number.isInteger(row.prev_attendance_days) && row.prev_attendance_days >= 0 && row.prev_attendance_days <= 366)) return fail("Days attended last year is a whole number up to 366.");
  if (!isDate(row.admission_date)) return fail("Enter the admission date as a date.");
  if (row.blood_group && !BLOOD.includes(row.blood_group)) return fail("Choose a blood group from the list.");
  if (row.pincode && !/^[1-9][0-9]{5}$/.test(row.pincode)) return fail("A PIN code has six digits and does not start with 0.");
  if (row.emergency_phone && !/^[0-9+ -]{7,20}$/.test(row.emergency_phone)) return fail("Enter the emergency phone number in digits.");
  const db = await untyped();
  const { data, error } = await db.from("student_profile").upsert({ student_id: studentId, ...row }, { onConflict: "student_id" }).select("student_id");
  if (error || !data?.length) return fail(error?.code === "42501" || !data?.length ? "You cannot change this student's details." : TRY_AGAIN);
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}

export async function saveStudentIdentity(studentId: number, input: Partial<StudentIdentity> & { aadhaar?: string }): Promise<Result> {
  const session = await getSession();
  if (!session?.isAdminScope) return fail("Only the office or the principal can change identity details.");
  if (!isId(studentId)) return fail(TRY_AGAIN);
  const digits = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");
  const apaar = digits(input.apaar_id) || null;
  const pen = digits(input.pen) || null;
  // Only the last four digits of Aadhaar are kept; a full number is cut down here.
  const aadhaarIn = digits(input.aadhaar ?? input.aadhaar_last4);
  const aadhaar_last4 = aadhaarIn ? aadhaarIn.slice(-4) : null;
  if (aadhaarIn && aadhaarIn.length !== 4 && aadhaarIn.length !== 12) return fail("Enter the 12-digit Aadhaar number or just its last 4 digits.");
  if (apaar && apaar.length !== 12) return fail("An APAAR ID has 12 digits.");
  if (pen && pen.length !== 11) return fail("A PEN has 11 digits.");
  const category = clean(input.category, 10);
  if (category && !CATEGORY.includes(category)) return fail("Choose a category from the list.");
  const minority = clean(input.minority, 12);
  if (minority && !MINORITY.includes(minority)) return fail("Choose a minority group from the list.");
  const udid = (clean(input.udid_no, 20) ?? "").replace(/\s/g, "") || null;
  if (udid && !/^[A-Za-z0-9]{10,20}$/.test(udid)) return fail("A UDID number has 10 to 20 letters and digits.");
  const db = await untyped();
  const { data, error } = await db.from("student_identity").upsert({
    student_id: studentId, apaar_id: apaar, pen, aadhaar_last4, category,
    religion: clean(input.religion, 40), special_needs: !!input.special_needs,
    special_needs_note: input.special_needs ? clean(input.special_needs_note, 200) : null, bpl: !!input.bpl,
    aadhaar_name: clean(input.aadhaar_name, 100), minority, disadvantaged: !!input.disadvantaged, aay: !!input.aay,
    disability_type: input.special_needs ? clean(input.disability_type, 60) : null, udid_no: input.special_needs ? udid : null, rte_admission: !!input.rte_admission,
  }, { onConflict: "student_id" }).select("student_id");
  if (error) return fail(error.code === "23505" ? "Another student in this school already has this APAAR ID or PEN." : TRY_AGAIN);
  if (!data?.length) return fail("You cannot change this student's identity details.");
  revalidatePath(`/dashboard/students/${studentId}`);
  return { ok: true };
}
