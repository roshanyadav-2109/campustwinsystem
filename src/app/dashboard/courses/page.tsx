import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { CourseOffice, MyCourses, type ElectiveRow, type PendingRow, type MyCourse } from "@/components/courses/courses";

// Course registration for the current semester (colleges and universities).
export default async function CoursesPage() {
  const denied = await guardTab("/dashboard/courses");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const { data: sem } = await supabase.from("semester" as never).select("id, kind, starts_on, ends_on").eq("is_current", true).maybeSingle();
  const s = sem as unknown as { id: number; kind: string; starts_on: string; ends_on: string } | null;
  if (!s) return (<div><PageHeader title="Courses" /><EmptyState art="nothing-yet" title="No current semester" hint="The office sets the semester in Settings, Programmes and courses." /></div>);

  if (session?.role === "student" && session.studentId) {
    const { data: mine } = await supabase.rpc("student_semester" as never, { p_student: session.studentId, p_semester: s.id } as never);
    const st = ((mine ?? []) as unknown as { programme_id: number; semester_no: number }[])[0];
    if (!st) return (<div><PageHeader title="My courses" /><EmptyState art="nothing-yet" title="Your programme is not set up yet" /></div>);
    const [pcs, regs] = await Promise.all([
      supabase.from("programme_course" as never).select("id, elective_group, seat_limit, course:course_id(code, name, kind, credits)").eq("programme_id", st.programme_id).eq("semester_no", st.semester_no),
      supabase.from("course_registration" as never).select("programme_course_id, status").eq("semester_id", s.id).eq("student_id", session.studentId).neq("status", "dropped"),
    ]);
    const reg = new Map(((regs.data ?? []) as unknown as { programme_course_id: number; status: string }[]).map((r) => [r.programme_course_id, r.status]));
    const { data: used } = await supabase.rpc("course_seat_usage" as never, { p_semester: s.id } as never);
    const count = new Map(((used ?? []) as unknown as { programme_course_id: number; used: number }[]).map((u) => [u.programme_course_id, u.used]));
    const courses: MyCourse[] = ((pcs.data ?? []) as unknown as { id: number; elective_group: string | null; seat_limit: number | null; course: { code: string; name: string; kind: string; credits: number } }[])
      .map((x) => ({ id: x.id, group: x.elective_group, seats: x.seat_limit, used: count.get(x.id) ?? 0, status: reg.get(x.id) ?? null, ...x.course }));
    return (
      <div className="space-y-4">
        <PageHeader title="My courses" description={`Semester ${st.semester_no} (${s.kind} semester). Choose one course in each choice group.`} />
        <MyCourses semesterId={s.id} studentId={session.studentId} courses={courses} />
      </div>
    );
  }

  const [pcs, regs] = await Promise.all([
    supabase.from("programme_course" as never).select("id, semester_no, elective_group, seat_limit, programme:programme_id(code), course:course_id(code, name, credits)").not("elective_group", "is", null).limit(2000),
    supabase.from("course_registration" as never).select("id, status, programme_course_id, student:student_id(full_name, admission_no)").eq("semester_id", s.id).neq("status", "dropped").limit(10000),
  ]);
  const regRows = (regs.data ?? []) as unknown as { id: number; status: string; programme_course_id: number; student: { full_name: string; admission_no: string } | null }[];
  const electives: ElectiveRow[] = ((pcs.data ?? []) as unknown as { id: number; semester_no: number; elective_group: string; seat_limit: number | null; programme: { code: string }; course: { code: string; name: string; credits: number } }[])
    .map((x) => ({ id: x.id, programme: x.programme.code, semester: x.semester_no, group: x.elective_group, seats: x.seat_limit, code: x.course.code, name: x.course.name, used: regRows.filter((r) => r.programme_course_id === x.id).length }));
  const pending: PendingRow[] = regRows.filter((r) => r.status === "registered").map((r) => ({ id: r.id, student: r.student?.full_name ?? "", adm: r.student?.admission_no ?? "", course: electives.find((e) => e.id === r.programme_course_id)?.name ?? "" }));
  return (
    <div className="space-y-4">
      <PageHeader title="Course registration" description={`${s.kind === "odd" ? "Odd" : "Even"} semester, ${s.starts_on.split("-").reverse().join("/")} to ${s.ends_on.split("-").reverse().join("/")}. ${regRows.length} registrations.`} />
      <CourseOffice semesterId={s.id} electives={electives} pending={pending} canEdit={session?.staffRole === "office"} />
    </div>
  );
}
