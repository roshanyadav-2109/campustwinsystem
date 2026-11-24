import { getOwnerEmail } from "@/lib/owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentYear, sectionClassMaps } from "@/lib/console/tenant";
import { csvResponse } from "@/lib/console/csv";

type Stu = { id: number; admission_no: string; full_name: string; gender: string | null; dob: string | null; email: string | null; phone: string | null; status: string };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getOwnerEmail())) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const schoolId = Number(id);
  const admin = createAdminClient();
  const { data: school } = await admin.from("school").select("slug").eq("id", schoolId).maybeSingle();
  if (!school) return new Response("Not found", { status: 404 });
  const [year, maps] = await Promise.all([currentYear(admin, schoolId), sectionClassMaps(admin, schoolId)]);

  const students: Stu[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("student").select("id, admission_no, full_name, gender, dob, email, phone, status").eq("school_id", schoolId).order("full_name").range(from, from + 999);
    students.push(...((data ?? []) as Stu[]));
    if (!data || data.length < 1000) break;
  }
  const enr = new Map<number, { section_id: number; roll_no: number | null }>();
  if (year) {
    for (let from = 0; ; from += 1000) {
      const { data } = await admin.from("student_enrollment").select("student_id, section_id, roll_no").eq("school_id", schoolId).eq("academic_year_id", year.id).range(from, from + 999);
      for (const e of data ?? []) enr.set(e.student_id, e);
      if (!data || data.length < 1000) break;
    }
  }
  return csvResponse(
    `${school.slug}-students-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Admission no", "Name", "Class", "Roll", "Gender", "Date of birth", "Email", "Phone", "Status"],
    students.map((s) => {
      const e = enr.get(s.id);
      return [s.admission_no, s.full_name, e ? maps.sectionLabel.get(e.section_id) ?? "" : "", e?.roll_no ?? "", s.gender, s.dob, s.email, s.phone, s.status];
    }),
  );
}
