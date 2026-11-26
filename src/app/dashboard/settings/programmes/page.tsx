import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { ProgrammesAdmin, type ProgrammeView, type DeptView } from "@/components/settings/programmes";

// Settings → Programmes and courses: departments, programmes (regulation,
// years, semesters) and the courses of each semester with their credits.
export default async function ProgrammesPage() {
  const denied = await guardTab("/dashboard/settings/programmes");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const [d, p, pc, sem] = await Promise.all([
    supabase.from("department" as never).select("id, code, name").order("code"),
    supabase.from("programme" as never).select("id, department_id, code, name, level, regulation, years, semesters, total_credits").order("code"),
    supabase.from("programme_course" as never).select("id, programme_id, semester_no, elective_group, course:course_id(code, name, kind, lecture, tutorial, practical, credits)").order("semester_no").limit(5000),
    supabase.from("semester" as never).select("kind, starts_on, ends_on, is_current").order("starts_on"),
  ]);
  const links = (pc.data ?? []) as unknown as { id: number; programme_id: number; semester_no: number; elective_group: string | null; course: ProgrammeView["courses"][number]["course"] }[];
  const programmes: ProgrammeView[] = ((p.data ?? []) as unknown as Omit<ProgrammeView, "courses">[]).map((x) => ({ ...x, courses: links.filter((l) => l.programme_id === x.id) }));
  const current = ((sem.data ?? []) as unknown as { kind: string; starts_on: string; ends_on: string; is_current: boolean }[]).find((s) => s.is_current);
  return (
    <div className="space-y-4">
      <PageHeader title="Programmes and courses" description={`Departments, programmes and the courses of each semester with credits (L-T-P).${current ? ` Current semester: ${current.kind}, ${current.starts_on.split("-").reverse().join("/")} to ${current.ends_on.split("-").reverse().join("/")}.` : ""}`} />
      <ProgrammesAdmin departments={(d.data ?? []) as unknown as DeptView[]} programmes={programmes} canEdit={session?.staffRole === "office"} />
    </div>
  );
}
