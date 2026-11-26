"use server";
import { revalidatePath } from "next/cache";
import { getSession, getCurrentYear } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/data/schedule";
import { wordsFor } from "@/editions/registry";

// Student ID cards, printed by the office from student records. Each student
// keeps one card (and one QR code) for the year: printing again reuses it.

export type IdCardData = {
  name: string; admissionNo: string; classLabel: string; rollNo: number | null; dob: string | null;
  bloodGroup: string | null; phone: string | null; photoUrl: string | null; token: string;
};
export type IdCardSheet = {
  school: { name: string; place: string | null; phone: string | null; logoUrl: string | null; color: string; signatory: string };
  yearName: string; classWord: string; cards: IdCardData[];
};
type Result = { ok: true; sheet: IdCardSheet } | { ok: false; error: string };
const isId = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

async function office() {
  const session = await getSession();
  return session?.staffId && session.staffRole === "office" ? session : null;
}

/** Cards for a whole section, or for one student. */
export async function prepareIdCards(input: { sectionId?: number; studentId?: number }): Promise<Result> {
  const session = await office();
  if (!session) return { ok: false, error: "Only the school office can print ID cards." };
  const year = await getCurrentYear();
  if (!year) return { ok: false, error: "No academic year is set as current." };
  if (!isId(input?.sectionId) && !isId(input?.studentId)) return { ok: false, error: "Choose a section." };
  const supabase = await createClient();
  const db = await untyped();

  let q = supabase.from("student_enrollment")
    .select("student_id, roll_no, section(name, class(name)), student!inner(full_name, admission_no, dob, photo_path, status)")
    .eq("academic_year_id", year.id).eq("student.status", "active");
  q = isId(input.studentId) ? q.eq("student_id", input.studentId) : q.eq("section_id", input.sectionId!);
  const { data: ens, error } = await q.order("roll_no", { nullsFirst: false }).limit(200);
  if (error) return { ok: false, error: "The students could not be read. Please try again." };
  type En = { student_id: number; roll_no: number | null; section: { name: string; class: { name: string } | null } | null; student: { full_name: string; admission_no: string; dob: string | null; photo_path: string | null } };
  const rows = (ens ?? []) as unknown as En[];
  if (!rows.length) return { ok: false, error: "No students on the roll there this year." };
  const ids = rows.map((r) => r.student_id);

  // One active card per student this year: reuse it, or issue it now.
  const { data: have } = await db.from("id_card").select("id, student_id, verify_token, prints").eq("academic_year_id", year.id).eq("status", "active").in("student_id", ids);
  const cardOf = new Map(((have ?? []) as { id: number; student_id: number; verify_token: string; prints: number }[]).map((c) => [c.student_id, c]));
  const missing = ids.filter((id) => !cardOf.has(id));
  if (missing.length) {
    const { data: made, error: e2 } = await db.from("id_card").insert(missing.map((student_id) => ({ student_id, academic_year_id: year.id }))).select("id, student_id, verify_token, prints");
    if (e2) return { ok: false, error: "The cards could not be prepared. Please try again." };
    for (const c of (made ?? []) as { id: number; student_id: number; verify_token: string; prints: number }[]) cardOf.set(c.student_id, c);
  }
  for (const c of cardOf.values()) await db.from("id_card").update({ prints: c.prints + 1 }).eq("id", c.id);

  // Blood group and the phone to call: the emergency contact, else a parent.
  const [{ data: prof }, { data: gs }, { data: sc }] = await Promise.all([
    db.from("student_profile").select("student_id, blood_group, emergency_phone").in("student_id", ids),
    supabase.from("guardian_student").select("student_id, is_primary, guardian(phone)").in("student_id", ids),
    db.from("school").select("name, place, phone, logo_url, primary_color, signatory_title").eq("id", session.schoolId).single(),
  ]);
  const profOf = new Map(((prof ?? []) as { student_id: number; blood_group: string | null; emergency_phone: string | null }[]).map((p) => [p.student_id, p]));
  const phoneOf = new Map<number, string>();
  for (const g of ((gs ?? []) as unknown as { student_id: number; is_primary: boolean; guardian: { phone: string | null } | null }[]).sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
    if (g.guardian?.phone && !phoneOf.has(g.student_id)) phoneOf.set(g.student_id, g.guardian.phone);
  }
  const s = (sc ?? {}) as { name?: string; place?: string | null; phone?: string | null; logo_url?: string | null; primary_color?: string | null; signatory_title?: string | null };
  return {
    ok: true,
    sheet: {
      school: { name: s.name ?? "", place: s.place ?? null, phone: s.phone ?? null, logoUrl: s.logo_url ?? null, color: s.primary_color || "#0F6CBD", signatory: s.signatory_title || "Principal" },
      yearName: year.name,
      classWord: wordsFor(session.school.edition).groupParent,
      cards: rows.map((r) => ({
        name: r.student.full_name, admissionNo: r.student.admission_no,
        classLabel: r.section ? `${r.section.class?.name ?? ""}-${r.section.name}` : "",
        rollNo: r.roll_no, dob: r.student.dob,
        bloodGroup: profOf.get(r.student_id)?.blood_group ?? null,
        phone: profOf.get(r.student_id)?.emergency_phone ?? phoneOf.get(r.student_id) ?? null,
        photoUrl: r.student.photo_path, token: cardOf.get(r.student_id)!.verify_token,
      })),
    },
  };
}

/** Card lost or damaged: the old QR stops working and a new card is issued. */
export async function replaceIdCard(studentId: number, reason: string): Promise<Result> {
  const session = await office();
  if (!session) return { ok: false, error: "Only the school office can replace ID cards." };
  const year = await getCurrentYear();
  if (!year || !isId(studentId)) return { ok: false, error: "That student could not be found." };
  const why = (reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "Replaced";
  const db = await untyped();
  await db.from("id_card").update({ status: "revoked", revoke_reason: why }).eq("student_id", studentId).eq("academic_year_id", year.id).eq("status", "active");
  revalidatePath(`/dashboard/students/${studentId}`);
  return prepareIdCards({ studentId });
}
