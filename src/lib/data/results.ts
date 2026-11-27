import "server-only";
import type { createClient } from "@/lib/supabase/server";

export type GradeCard = {
  student: string; admission_no: string; programme: string | null; semester_no: number | null; school: string; token: string;
  sgpa: number | null; cgpa: number | null; credits_registered: number; credits_earned: number; backlogs: number; published_at: string;
  courses: { code: string; name: string; credits: number; cia: number | null; cia_max: number | null; ese: number | null; ese_max: number | null; grade: string; point: number; passed: boolean }[];
};

// Published grade cards of some students (one semester, or all of them).
export async function loadCards(supabase: Awaited<ReturnType<typeof createClient>>, semesterId: number | null, studentIds: number[], school: string): Promise<GradeCard[]> {
  if (!studentIds.length) return [];
  let q = supabase.from("semester_result" as never).select("semester_id, student_id, semester_no, credits_registered, credits_earned, sgpa, cgpa, backlogs, verify_token, published_at, student:student_id(full_name, admission_no)").in("student_id", studentIds);
  if (semesterId) q = q.eq("semester_id", semesterId);
  const { data: srs } = await q.order("published_at", { ascending: false }).limit(1000);
  const rows = (srs ?? []) as unknown as { semester_id: number; student_id: number; semester_no: number | null; credits_registered: number; credits_earned: number; sgpa: number | null; cgpa: number | null; backlogs: number; verify_token: string; published_at: string; student: { full_name: string; admission_no: string } }[];
  if (!rows.length) return [];
  const { data: crs } = await supabase.from("course_result" as never).select("semester_id, student_id, credits, cia, cia_max, ese, ese_max, grade, point, passed, course:course_id(code, name)")
    .in("student_id", [...new Set(rows.map((r) => r.student_id))]).in("semester_id", [...new Set(rows.map((r) => r.semester_id))]).limit(10000);
  const courses = (crs ?? []) as unknown as { semester_id: number; student_id: number; credits: number; cia: number | null; cia_max: number | null; ese: number | null; ese_max: number | null; grade: string; point: number; passed: boolean; course: { code: string; name: string } }[];
  const { data: prog } = await supabase.from("student_enrollment").select("student_id, section:section_id(class:class_id(programme:programme_id(name)))" as "student_id").in("student_id", rows.map((r) => r.student_id)).limit(1000);
  const progName = new Map(((prog ?? []) as unknown as { student_id: number; section: { class: { programme: { name: string } | null } } }[]).map((p) => [p.student_id, p.section?.class?.programme?.name ?? null]));
  return rows.map((r) => ({
    student: r.student.full_name, admission_no: r.student.admission_no, programme: progName.get(r.student_id) ?? null, semester_no: r.semester_no, school, token: r.verify_token,
    sgpa: r.sgpa, cgpa: r.cgpa, credits_registered: Number(r.credits_registered), credits_earned: Number(r.credits_earned), backlogs: r.backlogs, published_at: r.published_at,
    courses: courses.filter((c) => c.student_id === r.student_id && c.semester_id === r.semester_id).map((c) => ({ code: c.course.code, name: c.course.name, credits: Number(c.credits), cia: c.cia, cia_max: c.cia_max, ese: c.ese, ese_max: c.ese_max, grade: c.grade, point: Number(c.point), passed: c.passed })),
  }));
}
