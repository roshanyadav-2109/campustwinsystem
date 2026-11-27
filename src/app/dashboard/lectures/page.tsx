import Link from "next/link";
import { guardTab } from "@/lib/access";
import { getSession, getCurrentYear } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope, getSectionStudents } from "@/lib/data/scope";
import { LectureMarker, AttendanceShortage, MyAttendance, type AttRow } from "@/components/courses/lectures";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Lecture attendance and the 75% rule (colleges and universities).
export default async function LecturesPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/lectures");
  if (denied) return denied;
  const [session, year, sp] = await Promise.all([getSession(), getCurrentYear(), searchParams]);
  const supabase = await createClient();
  const { data: semData } = await supabase.from("semester" as never).select("id, kind, starts_on, ends_on").eq("is_current", true).maybeSingle();
  const sem = semData as unknown as { id: number; kind: string; starts_on: string; ends_on: string } | null;
  if (!session || !year || !sem) return (<div><PageHeader title="Lectures" /><EmptyState art="nothing-yet" title="No current semester" /></div>);
  const { data: sch } = await supabase.from("school").select("attendance_minimum, attendance_lock_mode, attendance_edit_days" as "id").eq("id", session.schoolId).maybeSingle();
  const rules = sch as unknown as { attendance_minimum: number; attendance_lock_mode: string; attendance_edit_days: number } | null;
  const minimum = Number(rules?.attendance_minimum ?? 75);
  const { data: cutData } = await supabase.from("semester" as never).select("attendance_cutoff").eq("id", sem.id).maybeSingle();
  const cutoff = (cutData as unknown as { attendance_cutoff: string | null } | null)?.attendance_cutoff ?? null;
  const mode = rules?.attendance_lock_mode ?? "daily";
  const lockNote = [
    mode === "daily" || mode === "both" ? `A lecture can be marked or corrected up to ${rules?.attendance_edit_days ?? 3} days later.` : "",
    (mode === "cutoff" || mode === "both") && cutoff ? `Attendance up to ${new Date(cutoff + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} is frozen for exams after that date.` : "",
  ].filter(Boolean).join(" ") || null;
  const { data: waitData } = await supabase.from("relaxation_request" as never).select("student_id, subject_id").eq("kind", "attendance").eq("status", "pending").eq("semester_id", sem.id);
  const waiting = ((waitData ?? []) as unknown as { student_id: number; subject_id: number }[]).map((w) => `${w.student_id}-${w.subject_id}`);

  if (session.role === "student" && session.studentId) {
    const { data } = await supabase.rpc("course_attendance" as never, { p_section: null, p_student: session.studentId } as never);
    return (<div className="space-y-4"><PageHeader title="My attendance" description={`This semester, per course. At least ${minimum}% is needed to sit the exam.`} /><MyAttendance rows={(data ?? []) as unknown as AttRow[]} minimum={minimum} waiting={waiting} /></div>);
  }

  const scope = await getStaffScope();
  const metas = scope.isAdmin ? scope.sectionMeta.length ? scope.sectionMeta : [] : scope.sectionMeta;
  const sections = (scope.isAdmin ? scope.sections.map((s) => ({ id: s.id, label: `${s.class_name}-${s.name}`, subjects: scope.subjectsByClass[s.class_id] ?? [] }))
    : metas.map((m) => ({ id: m.id, label: m.label, subjects: m.subjects })));
  // Heads of Department, Deans and coordinators also see their department's sections (shortage list; marking stays with teachers)
  if (!scope.isAdmin) {
    const { data: scoped } = await supabase.rpc("my_scope_sections" as never);
    for (const x of (scoped ?? []) as unknown as { id: number; label: string }[]) if (!sections.some((o) => o.id === x.id)) sections.push({ id: x.id, label: x.label, subjects: [] });
  }
  if (!sections.length) return (<div><PageHeader title="Lectures" /><EmptyState art="no-sections" title="No sections to show" /></div>);
  const sectionId = Number(one(sp.section)) || sections[0].id;
  const section = sections.find((s) => s.id === sectionId) ?? sections[0];
  const [roster, att] = await Promise.all([
    getSectionStudents(section.id, year.id),
    supabase.rpc("course_attendance" as never, { p_section: section.id, p_student: null } as never),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Lectures" description={`${sem.kind === "odd" ? "Odd" : "Even"} semester. Mark each lecture; percentages below ${minimum}% are a shortage.`} />
      <div className="flex flex-wrap gap-1.5">{sections.map((s) => (
        <Link key={s.id} href={`?section=${s.id}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === section.id ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700 hover:bg-panel"}`}>{s.label}</Link>))}
      </div>
      {section.subjects.length > 0 && <LectureMarker key={section.id} sectionId={section.id} subjects={section.subjects.map((x) => ({ id: x.id, name: x.name }))} roster={roster.map((r) => ({ id: r.id, name: r.name, roll: r.roll }))} lockNote={lockNote} />}
      <AttendanceShortage rows={(att.data ?? []) as unknown as AttRow[]} minimum={minimum} waiting={waiting} />
    </div>
  );
}
