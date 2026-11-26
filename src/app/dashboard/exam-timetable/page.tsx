import Link from "next/link";
import { guardTab } from "@/lib/access";
import { getCurrentYear, getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope } from "@/lib/data/scope";
import { getMyChildren } from "@/lib/data/analytics";
import { ExamsDesk, FamilyExams, type SessionView, type PaperView } from "@/components/exams/exams-desk";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PATH = "/dashboard/exam-timetable";

export default async function ExamTimetablePage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab(PATH);
  if (denied) return denied;
  const [session, year, sp] = await Promise.all([getSession(), getCurrentYear(), searchParams]);
  if (!session || !year) return <EmptyState art="error" title="No current school year is set" />;
  const supabase = await createClient();
  const verifyBase = `https://verify.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}/verify/`;

  const { data: sData } = await supabase.from("exam_session" as never)
    .select("id, name, term, assessment_type_id, instructions, withhold_fee_dues, published_at").eq("academic_year_id", year.id).order("created_at");
  const sessions = (sData ?? []) as unknown as SessionView[];

  // ---------- families ----------
  if (session.role === "guardian" || session.role === "student") {
    const kids = session.role === "guardian" ? await getMyChildren() : [];
    const ids = session.role === "guardian" ? kids.map((k) => k.id) : session.studentId ? [session.studentId] : [];
    const { data: en } = await supabase.from("student_enrollment").select("student_id, section_id, section:section_id(class_id), student:student_id(full_name)")
      .in("student_id", ids.length ? ids : [0]).eq("academic_year_id", year.id).eq("status", "active");
    const children = ((en ?? []) as unknown as { student_id: number; section_id: number; section: { class_id: number }; student: { full_name: string } }[])
      .map((e) => ({ id: e.student_id, name: e.student.full_name, sectionId: e.section_id, classId: e.section.class_id }));
    const { data: pData } = await supabase.from("exam_paper" as never).select("id, session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks, note, component, optional_group, subject:subject_id(name)")
      .in("class_id", children.length ? children.map((c) => c.classId) : [0]).order("exam_date").order("starts_at");
    const papers = (pData ?? []) as unknown as PaperView[];
    return (
      <div className="space-y-4">
        <PageHeader title="Exam timetable" description="Date sheets the school has published, and admit cards to download." />
        {sessions.length === 0 || children.length === 0
          ? <EmptyState art="nothing-yet" title="No exam timetable yet" hint="When the school publishes a date sheet, it appears here." />
          : <FamilyExams sessions={sessions} papers={papers} children={children} school={session.school.name} verifyBase={verifyBase} />}
      </div>
    );
  }

  // ---------- staff ----------
  const scope = await getStaffScope();
  const [{ data: types }, { data: subjects }, { data: cs }] = await Promise.all([
    supabase.from("assessment_type").select("id, name, is_numeric").order("name"),
    supabase.from("subject").select("id, name").order("name"),
    supabase.from("class_subject").select("class_id, subject_id").limit(5000),
  ]);
  const sessionId = Number(one(sp.exam)) || sessions.at(-1)?.id || null;
  const { data: pData } = sessionId
    ? await supabase.from("exam_paper" as never).select("id, session_id, class_id, subject_id, exam_date, starts_at, ends_at, max_marks, note, component, optional_group, subject:subject_id(name)").eq("session_id", sessionId).order("exam_date").order("starts_at")
    : { data: [] };
  const papers = (pData ?? []) as unknown as PaperView[];
  const printable = scope.isAdmin
    ? scope.sections.map((s) => ({ id: s.id, label: `${s.class_name}-${s.name}`, classId: s.class_id, level: s.class_level }))
    : scope.sectionMeta.filter((m) => m.isClassTeacher).map((m) => ({ id: m.id, label: m.label, classId: m.classId, level: m.classLevel }));
  printable.sort((a, b) => a.level - b.level || a.label.localeCompare(b.label));

  return (
    <div className="space-y-4">
      <PageHeader title="Exam timetable" description={`Date sheets and admit cards for ${year.name}. Each paper creates its marks column in every section of the class.`} />
      <div className="flex flex-wrap gap-1.5" role="navigation" aria-label="Choose an exam">
        {sessions.map((s) => (
          <Link key={s.id} href={`${PATH}?exam=${s.id}`}
            className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === sessionId ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700 hover:bg-panel"}`}>
            {s.name}{s.published_at ? "" : " (draft)"}</Link>
        ))}
      </div>
      <ExamsDesk key={sessionId ?? "none"} canEdit={session.staffRole === "office"} sessions={sessions} sessionId={sessionId} papers={papers}
        types={(types ?? []).filter((t) => t.is_numeric).map((t) => ({ id: t.id, name: t.name }))}
        classes={scope.classes.map((c) => ({ id: c.id, name: c.name, subjects: (cs ?? []).filter((x) => x.class_id === c.id).map((x) => x.subject_id) }))}
        subjects={(subjects ?? []).map((s) => ({ id: s.id, name: s.name }))}
        sections={printable} school={session.school.name} verifyBase={verifyBase} />
    </div>
  );
}
