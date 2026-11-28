import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getCurrentYear } from "@/lib/session";
import { EmptyState } from "@/components/ui/empty";
import { StaffList, type StaffRow } from "@/components/manage/teachers/staff-list";
import { StaffImport } from "@/components/manage/teachers/staff-import";
import { Assignments, type AssignRow, type SectionOpt, type SubjectOpt } from "@/components/manage/teachers/assignments";

// The API returns at most 1000 rows per request, so read the year's
// assignments page by page.
async function loadAllotments(supabase: Awaited<ReturnType<typeof createClient>>, yearId: number) {
  const PAGE = 1000;
  const out: { id: number; staff_id: number; section_id: number; subject_id: number | null; is_class_teacher: boolean }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("teacher_allotment")
      .select("id, staff_id, section_id, subject_id, is_class_teacher")
      .eq("academic_year_id", yearId)
      .order("id")
      .range(from, from + PAGE - 1);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// Manage School › Assigned Teachers: the staff list, and who teaches which
// subject in which section (plus each section's class teacher) this year.
async function ManageTeachersPageBody() {
  const supabase = await createClient();
  const year = await getCurrentYear();
  if (!year) return <EmptyState art="error" title="No current school year is set" hint="Ask the person who set up the portal to mark this year as current." />;

  const [staffRes, loginRes, sectionRes, subjectRes, classSubjectRes, allotRes] = await Promise.all([
    supabase.from("staff").select("id, full_name, role, employee_code, email, phone, photo_path, gender, qualification, appointment, joined_on, left_on" as "id, full_name, role, employee_code, email, phone, photo_path").order("full_name"),
    supabase.from("profile").select("staff_id").not("staff_id", "is", null),
    supabase.from("section").select("id, name, class:class_id(id, name, level)"),
    supabase.from("subject").select("id, name, code").order("name"),
    supabase.from("class_subject").select("class_id, subject_id"),
    loadAllotments(supabase, year.id),
  ]);

  const withLogin = new Set((loginRes.data ?? []).map((p) => p.staff_id));
  // current positions (colleges and universities): "Dean, Faculty of Engineering; Director, Department of CSE"
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: posData } = await supabase.from("staff_position" as never)
    .select("staff_id, acting, starts_on, ends_on, title:title_id(name, sort), unit:unit_id(name), department:department_id(name), programme:programme_id(name)").limit(2000);
  const titlesOf = new Map<number, string[]>();
  for (const p of (posData ?? []) as unknown as { staff_id: number; acting: boolean; starts_on: string; ends_on: string | null; title: { name: string } | null; unit: { name: string } | null; department: { name: string } | null; programme: { name: string } | null }[]) {
    if (p.starts_on > today || (p.ends_on && p.ends_on < today) || !p.title) continue;
    const where = p.unit?.name ?? p.department?.name ?? p.programme?.name;
    titlesOf.set(p.staff_id, [...(titlesOf.get(p.staff_id) ?? []), `${p.acting ? "Acting " : ""}${p.title.name}${where ? `, ${where}` : ""}`]);
  }
  const staff: StaffRow[] = (staffRes.data ?? []).map((s) => ({
    id: s.id,
    fullName: s.full_name,
    role: s.role,
    employeeCode: s.employee_code ?? "",
    gender: (s as unknown as { gender: string | null }).gender, qualification: (s as unknown as { qualification: string | null }).qualification,
    appointment: (s as unknown as { appointment: string | null }).appointment, joinedOn: (s as unknown as { joined_on: string | null }).joined_on, leftOn: (s as unknown as { left_on: string | null }).left_on,
    email: s.email ?? "",
    phone: s.phone ?? "",
    hasLogin: withLogin.has(s.id),
    photoUrl: (s as { photo_path?: string | null }).photo_path ?? null,
    titles: titlesOf.get(s.id)?.join("; ") ?? null,
  }));

  const sections: SectionOpt[] = (sectionRes.data ?? [])
    .map((s) => {
      const c = s.class as unknown as { id: number; name: string; level: number } | null;
      return { id: s.id, name: s.name, classId: c?.id ?? 0, className: c?.name ?? "—", classLevel: c?.level ?? 99 };
    })
    .sort((a, b) => a.classLevel - b.classLevel || a.name.localeCompare(b.name));

  const subjects: SubjectOpt[] = (subjectRes.data ?? []).map((s) => ({ id: s.id, name: s.name, code: s.code }));
  const classSubjects = (classSubjectRes.data ?? []).map((cs) => [cs.class_id, cs.subject_id] as [number, number]);
  const rows: AssignRow[] = allotRes.map((a) => ({
    id: a.id, staffId: a.staff_id, sectionId: a.section_id, subjectId: a.subject_id, isClassTeacher: a.is_class_teacher,
  }));

  return (
    <div className="space-y-6">
      <StaffList staff={staff} />
      <StaffImport />
      <Assignments
        yearName={year.name}
        staff={staff.map((s) => ({ id: s.id, fullName: s.fullName, role: s.role }))}
        sections={sections}
        subjects={subjects}
        classSubjects={classSubjects}
        rows={rows}
      />
    </div>
  );
}

// Guarded on its own address, so a shared link cannot open it for the wrong role.
export default async function ManageTeachersPage() {
  const denied = await guardTab("/dashboard/settings/teachers");
  if (denied) return denied;
  return (
    <div>
      <PageHeader title="Teachers and assignments" description="Staff, and who teaches which subject in which section this year." />
      {await ManageTeachersPageBody()}
    </div>
  );
}
