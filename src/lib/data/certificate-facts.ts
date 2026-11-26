import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/data/schedule";

// Everything certificates draw on for one student, read with the office's own
// access. Fields a school fills in by hand (conduct, reason for leaving ...)
// are not here; they come from the issue form.
export type CertificateFacts = {
  school: {
    name: string; place: string | null; address: string | null; phone: string | null; email: string | null;
    affiliationBoard: string | null; affiliationNo: string | null; schoolCode: string | null; udise: string | null;
    signatoryName: string | null; signatoryTitle: string | null; tcFormat: "cbse" | "state";
  };
  student: {
    id: number; name: string; admissionNo: string; dob: string | null; gender: string | null;
    status: string; leftOn: string | null; exitRemark: string | null;
  };
  mother: string | null; father: string | null;
  profile: { nationality: string | null; admissionDate: string | null; admittedClass: string | null; motherTongue: string | null; placeOfBirth: string | null; previousSchool: string | null };
  identity: { category: string | null; religion: string | null; pen: string | null };
  lastClass: { name: string | null; level: number | null; section: string | null; yearName: string | null } | null;
  subjects: string[];
  workingDays: number; daysPresent: number;
  feesPaidUpTo: string | null;   // "YYYY-MM" of the last bill fully paid
  duesPending: number;           // rupees still owed
  concessions: string[];
};

export async function getCertificateFacts(studentId: number, schoolId: number): Promise<CertificateFacts | null> {
  const supabase = await createClient();
  const db = await untyped();
  const [{ data: sc }, { data: st }, { data: gs }, { data: prof }, { data: idn }, { data: ens }] = await Promise.all([
    db.from("school").select("name, place, address, phone, email, affiliation_board, affiliation_no, board_school_code, udise_code, signatory_name, signatory_title, tc_format").eq("id", schoolId).single(),
    supabase.from("student").select("id, full_name, admission_no, dob, gender, status, left_on, exit_remark").eq("id", studentId).maybeSingle(),
    supabase.from("guardian_student").select("guardian(full_name, relation)").eq("student_id", studentId),
    db.from("student_profile").select("nationality, admission_date, admitted_class, mother_tongue, place_of_birth, previous_school").eq("student_id", studentId).maybeSingle(),
    db.from("student_identity").select("category, religion, pen").eq("student_id", studentId).maybeSingle(),
    supabase.from("student_enrollment").select("academic_year_id, section_id, section(name, class_id, class(name, level)), academic_year(name, start_date)").eq("student_id", studentId),
  ]);
  if (!st || !sc) return null;
  const s = sc as Record<string, string | null>;
  const parents = ((gs ?? []) as unknown as { guardian: { full_name: string; relation: string | null } | null }[]).map((g) => g.guardian).filter(Boolean) as { full_name: string; relation: string | null }[];
  const mother = parents.find((g) => /mother/i.test(g.relation ?? ""))?.full_name ?? null;
  const father = parents.find((g) => !/mother/i.test(g.relation ?? ""))?.full_name ?? null;

  // The last year the student was on the roll.
  type En = { academic_year_id: number; section_id: number; section: { name: string; class_id: number; class: { name: string; level: number } | null } | null; academic_year: { name: string; start_date: string } | null };
  const last = ((ens ?? []) as unknown as En[]).sort((a, b) => (b.academic_year?.start_date ?? "").localeCompare(a.academic_year?.start_date ?? ""))[0];

  let subjects: string[] = [], workingDays = 0, daysPresent = 0, feesPaidUpTo: string | null = null, duesPending = 0, concessions: string[] = [];
  if (last) {
    const [{ data: subs }, days, present, { data: bills }, { data: conc }] = await Promise.all([
      supabase.from("class_subject").select("subject(name)").eq("class_id", last.section?.class_id ?? 0),
      supabase.rpc("section_working_days" as never, { p_section: last.section_id, p_year: last.academic_year_id } as never),
      supabase.from("attendance_record").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("academic_year_id", last.academic_year_id).is("period", null).in("status", ["present", "late"]),
      db.from("fee_invoice").select("due_date, amount, paid_amount, status").eq("student_id", studentId).eq("academic_year_id", last.academic_year_id).neq("status", "cancelled").order("due_date"),
      db.from("student_concession").select("fee_concession_type(name)").eq("student_id", studentId).eq("academic_year_id", last.academic_year_id).eq("status", "active"),
    ]);
    subjects = ((subs ?? []) as unknown as { subject: { name: string } | null }[]).map((r) => r.subject?.name).filter(Boolean) as string[];
    workingDays = Number(days.data ?? 0);
    daysPresent = present.count ?? 0;
    const b = (bills ?? []) as { due_date: string; amount: number | string; paid_amount: number | string; status: string }[];
    const paid = b.filter((x) => x.status === "paid");
    feesPaidUpTo = paid.length ? paid[paid.length - 1].due_date.slice(0, 7) : null;
    duesPending = Math.round(b.reduce((n, x) => n + Math.max(0, Number(x.amount) - Number(x.paid_amount)), 0) * 100) / 100;
    concessions = ((conc ?? []) as unknown as { fee_concession_type: { name: string } | null }[]).map((r) => r.fee_concession_type?.name).filter(Boolean) as string[];
  }

  const p = (prof ?? {}) as Record<string, string | null>;
  const i = (idn ?? {}) as Record<string, string | null>;
  return {
    school: {
      name: s.name ?? "", place: s.place, address: s.address, phone: s.phone, email: s.email,
      affiliationBoard: s.affiliation_board, affiliationNo: s.affiliation_no, schoolCode: s.board_school_code, udise: s.udise_code,
      signatoryName: s.signatory_name, signatoryTitle: s.signatory_title, tcFormat: s.tc_format === "state" ? "state" : "cbse",
    },
    student: { id: st.id, name: st.full_name, admissionNo: st.admission_no, dob: st.dob, gender: st.gender as string | null, status: st.status, leftOn: st.left_on, exitRemark: st.exit_remark },
    mother, father,
    profile: { nationality: p.nationality ?? null, admissionDate: p.admission_date ?? null, admittedClass: p.admitted_class ?? null, motherTongue: p.mother_tongue ?? null, placeOfBirth: p.place_of_birth ?? null, previousSchool: p.previous_school ?? null },
    identity: { category: i.category ?? null, religion: i.religion ?? null, pen: i.pen ?? null },
    lastClass: last ? { name: last.section?.class?.name ?? null, level: last.section?.class?.level ?? null, section: last.section?.name ?? null, yearName: last.academic_year?.name ?? null } : null,
    subjects, workingDays, daysPresent, feesPaidUpTo, duesPending, concessions,
  };
}
