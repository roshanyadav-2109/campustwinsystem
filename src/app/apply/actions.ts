"use server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_RE, LIMITS, cleanPhone, isIsoDate, todayIso } from "@/components/admissions/shared";

// The public application form. Visitors are not signed in, so this is the one
// place that writes with the service-role key. It does exactly one thing with
// it: insert a single row into admission_enquiry with a fixed set of columns,
// after strict checks. Nothing from the database is ever sent back.

export type ApplyInput = {
  childName: string;
  dateOfBirth: string;
  classId: number | null;
  guardianName: string;
  phone: string;
  email: string;
  previousSchool: string;
  message: string;
  // Hidden field real visitors never see or fill.
  website: string;
};

export type ApplyResult = { ok: true; firstName: string; token?: string } | { ok: false; error: string };

const TRY_AGAIN = "We could not send your application just now. Please try again in a little while, or contact the school office.";

const oneLine = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
const firstNameOf = (name: string) => name.split(" ")[0].slice(0, 40);

export async function submitApplication(input: ApplyInput): Promise<ApplyResult> {
  const childName = oneLine(input?.childName);
  const guardianName = oneLine(input?.guardianName);
  const email = oneLine(input?.email).toLowerCase();
  const previousSchool = oneLine(input?.previousSchool);
  const message = typeof input?.message === "string" ? input.message.trim() : "";
  const dob = oneLine(input?.dateOfBirth);
  const classId = typeof input?.classId === "number" && Number.isInteger(input.classId) && input.classId > 0 ? input.classId : null;

  // Honeypot: an automated form-filler gets the same answer as a real family,
  // and nothing is saved.
  if (typeof input?.website === "string" && input.website.trim() !== "") {
    return { ok: true, firstName: firstNameOf(childName) || "your child" };
  }

  if (!childName) return { ok: false, error: "Please enter your child's name." };
  if (childName.length > LIMITS.name) return { ok: false, error: `The child's name can be at most ${LIMITS.name} characters.` };
  if (!dob || !isIsoDate(dob) || dob > todayIso() || dob < "1990-01-01") return { ok: false, error: "Please enter your child's date of birth." };
  if (!classId) return { ok: false, error: "Please choose the class you are applying for." };
  if (!guardianName) return { ok: false, error: "Please enter the parent's name." };
  if (guardianName.length > LIMITS.name) return { ok: false, error: `The parent's name can be at most ${LIMITS.name} characters.` };
  const phone = cleanPhone(typeof input?.phone === "string" ? input.phone : "");
  if (!phone) return { ok: false, error: "Please enter a phone number with 8 to 15 digits." };
  if (email && (email.length > LIMITS.email || !EMAIL_RE.test(email))) return { ok: false, error: "Please enter a valid email address, or leave it empty." };
  if (previousSchool.length > LIMITS.school) return { ok: false, error: `The previous school can be at most ${LIMITS.school} characters.` };
  if (message.length > LIMITS.message) return { ok: false, error: `The message can be at most ${LIMITS.message} characters.` };

  try {
    const db = createAdminClient() as unknown as SupabaseClient;

    // The chosen class pins the institution (every class belongs to one). The
    // current academic year is then that institution's current year. (Under
    // per-subdomain branding, a site only offers its own institution's classes.)
    const cls = await db.from("class").select("id, school_id").eq("id", classId).maybeSingle();
    if (cls.error) return { ok: false, error: TRY_AGAIN };
    if (!cls.data) return { ok: false, error: "Please choose the class you are applying for." };
    const schoolId = (cls.data as { school_id: number }).school_id;

    const year = await db.from("academic_year").select("id").eq("is_current", true).eq("school_id", schoolId).maybeSingle();
    if (year.error) return { ok: false, error: TRY_AGAIN };
    if (!year.data) return { ok: false, error: TRY_AGAIN };

    // One application per phone number per day.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await db
      .from("admission_enquiry")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .gte("created_at", since);
    if (recent.error) return { ok: false, error: TRY_AGAIN };
    if ((recent.count ?? 0) > 0) {
      return { ok: false, error: "We already have your application. The school office will contact you." };
    }

    const { data: made, error } = await db.from("admission_enquiry").insert({
      child_name: childName,
      date_of_birth: dob,
      class_id: classId,
      guardian_name: guardianName,
      phone,
      email: email || null,
      previous_school: previousSchool || null,
      message: message || null,
      source: "online",
      status: "new",
      academic_year_id: (year.data as { id: number }).id,
      school_id: schoolId,
    }).select("public_token").single();
    if (error) return { ok: false, error: TRY_AGAIN };
    return { ok: true, firstName: firstNameOf(childName), token: (made as { public_token: string } | null)?.public_token };
  } catch {
    return { ok: false, error: TRY_AGAIN };
  }

  return { ok: true, firstName: firstNameOf(childName) };
}
