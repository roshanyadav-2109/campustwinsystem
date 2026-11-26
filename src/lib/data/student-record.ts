import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/data/schedule";

// Everything about one student, read with the signed-in person's own access:
// the database decides what they may see (identity details only for the
// office and principal; everyone else gets null there).

export type StudentProfile = {
  admission_date: string | null; admitted_class: string | null; previous_school: string | null;
  mother_tongue: string | null; nationality: string | null; place_of_birth: string | null;
  blood_group: string | null; house: string | null;
  address_line: string | null; city: string | null; state: string | null; pincode: string | null;
  allergies: string | null; medical_notes: string | null; emergency_name: string | null; emergency_phone: string | null;
};
export type StudentIdentity = {
  apaar_id: string | null; pen: string | null; aadhaar_last4: string | null; category: string | null;
  religion: string | null; special_needs: boolean; special_needs_note: string | null; bpl: boolean;
};
export type StudentRecord = {
  id: number; fullName: string; admissionNo: string; dob: string | null; gender: string | null;
  email: string | null; phone: string | null; status: string; leftOn: string | null; exitRemark: string | null;
  classLabel: string | null; rollNo: number | null;
  guardians: { name: string; relation: string | null; phone: string | null; email: string | null }[];
  siblings: { id: number; name: string; classLabel: string | null }[];
  profile: StudentProfile | null;
  identity: StudentIdentity | null;
};

export const EMPTY_PROFILE: StudentProfile = {
  admission_date: null, admitted_class: null, previous_school: null, mother_tongue: null, nationality: null, place_of_birth: null,
  blood_group: null, house: null, address_line: null, city: null, state: null, pincode: null,
  allergies: null, medical_notes: null, emergency_name: null, emergency_phone: null,
};
export const EMPTY_IDENTITY: StudentIdentity = {
  apaar_id: null, pen: null, aadhaar_last4: null, category: null, religion: null, special_needs: false, special_needs_note: null, bpl: false,
};

const PROFILE_COLS = "admission_date, admitted_class, previous_school, mother_tongue, nationality, place_of_birth, blood_group, house, address_line, city, state, pincode, allergies, medical_notes, emergency_name, emergency_phone";
const IDENTITY_COLS = "apaar_id, pen, aadhaar_last4, category, religion, special_needs, special_needs_note, bpl";

export async function getStudentRecord(studentId: number, yearId: number | null, withIdentity: boolean): Promise<StudentRecord | null> {
  const supabase = await createClient();
  const db = await untyped();
  const { data: s } = await supabase.from("student")
    .select("id, full_name, admission_no, dob, gender, email, phone, status, left_on, exit_remark").eq("id", studentId).maybeSingle();
  if (!s) return null;

  const [{ data: en }, { data: gs }, { data: prof }, ident] = await Promise.all([
    yearId
      ? supabase.from("student_enrollment").select("roll_no, section:section_id(name, class:class_id(name))").eq("student_id", studentId).eq("academic_year_id", yearId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("guardian_student").select("guardian_id, guardian(full_name, relation, phone, email)").eq("student_id", studentId),
    db.from("student_profile").select(PROFILE_COLS).eq("student_id", studentId).maybeSingle(),
    withIdentity ? db.from("student_identity").select(IDENTITY_COLS).eq("student_id", studentId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const sec = (en as unknown as { roll_no: number | null; section: { name: string; class: { name: string } | null } | null } | null);
  const links = (gs ?? []) as unknown as { guardian_id: number; guardian: { full_name: string; relation: string | null; phone: string | null; email: string | null } | null }[];

  // Brothers and sisters: other children of the same parents, this year.
  let siblings: StudentRecord["siblings"] = [];
  const guardianIds = links.map((l) => l.guardian_id);
  if (guardianIds.length) {
    const { data: sib } = await supabase.from("guardian_student").select("student_id, student(full_name)").in("guardian_id", guardianIds).neq("student_id", studentId);
    const ids = [...new Set(((sib ?? []) as unknown as { student_id: number }[]).map((r) => r.student_id))];
    const names = new Map(((sib ?? []) as unknown as { student_id: number; student: { full_name: string } | null }[]).map((r) => [r.student_id, r.student?.full_name ?? "Student"]));
    const { data: sibEn } = ids.length && yearId
      ? await supabase.from("student_enrollment").select("student_id, section:section_id(name, class:class_id(name))").in("student_id", ids).eq("academic_year_id", yearId)
      : { data: [] };
    const cls = new Map(((sibEn ?? []) as unknown as { student_id: number; section: { name: string; class: { name: string } | null } | null }[])
      .map((r) => [r.student_id, r.section ? `${r.section.class?.name ?? ""}-${r.section.name}` : null]));
    siblings = ids.map((id) => ({ id, name: names.get(id) ?? "Student", classLabel: cls.get(id) ?? null }));
  }

  return {
    id: s.id, fullName: s.full_name, admissionNo: s.admission_no, dob: s.dob, gender: s.gender as string | null,
    email: s.email, phone: s.phone, status: s.status, leftOn: s.left_on, exitRemark: s.exit_remark,
    classLabel: sec?.section ? `${sec.section.class?.name ?? ""}-${sec.section.name}` : null, rollNo: sec?.roll_no ?? null,
    guardians: links.filter((l) => l.guardian).map((l) => ({ name: l.guardian!.full_name, relation: l.guardian!.relation, phone: l.guardian!.phone, email: l.guardian!.email })),
    siblings,
    profile: (prof as StudentProfile | null) ?? null,
    identity: withIdentity ? ((ident.data as StudentIdentity | null) ?? null) : null,
  };
}
