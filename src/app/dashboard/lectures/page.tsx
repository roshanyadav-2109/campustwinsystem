import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession, getCurrentYear } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope, getSectionStudents } from "@/lib/data/scope";
import { LectureMarker, AttendanceShortage, MyAttendance, type AttRow } from "@/components/courses/lectures";
import { PartsTable, MyCorrections, CorrectionsInbox, PartsSetup, type PartRow, type Absence, type Correction } from "@/components/courses/attendance-parts";

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
    const since = new Date(Date.now() + 5.5 * 3600 * 1000 - 15 * 86400000).toISOString().slice(0, 10);
    const [{ data }, { data: partsData }, { data: absData }, { data: corrData }] = await Promise.all([
      supabase.rpc("course_attendance" as never, { p_section: null, p_student: session.studentId } as never),
      supabase.rpc("course_attendance_parts" as never, { p_section: null, p_student: session.studentId } as never),
      supabase.from("attendance_record").select("on_date, period, subject_id, component, subject:subject_id(name)" as "on_date").eq("student_id", session.studentId).eq("status", "absent").not("period", "is", null).not("subject_id", "is", null).gte("on_date", since).order("on_date", { ascending: false }).limit(60),
      supabase.from("attendance_correction" as never).select("id, student_id, subject_id, on_date, period, reason, status, decision_note, subject:subject_id(name)").eq("student_id", session.studentId).order("created_at", { ascending: false }).limit(30),
    ]);
    const rows = (data ?? []) as unknown as AttRow[];
    const names = Object.fromEntries(rows.map((r) => [r.subject_id, r.subject]));
    const abs = ((absData ?? []) as unknown as (Omit<Absence, "subject"> & { subject: { name: string } | null })[]).map((a) => ({ ...a, subject: a.subject?.name ?? null }));
    const sent = ((corrData ?? []) as unknown as (Omit<Correction, "subject"> & { subject: { name: string } | null })[]).map((c) => ({ ...c, subject: c.subject?.name ?? null }));
    return (<div className="space-y-4"><PageHeader title="My attendance" description={`This semester, per course. At least ${minimum}% is needed to sit the exam.`} />
      <MyAttendance rows={rows} minimum={minimum} waiting={waiting} />
      <PartsTable rows={(partsData ?? []) as unknown as PartRow[]} names={names} minimum={minimum} />
      <MyCorrections studentId={session.studentId} absences={abs} sent={sent} /></div>);
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
  // electives this teacher takes across sections: one roster for the whole course
  const { data: elData } = await supabase.rpc("my_elective_courses" as never);
  const electives = (elData ?? []) as unknown as { subject_id: number; subject_name: string; sections: number }[];
  const electiveId = Number(one(sp.elective)) || 0;
  const elective = electives.find((e) => e.subject_id === electiveId) ?? null;
  const sectionId = Number(one(sp.section)) || sections[0].id;
  const section = sections.find((s) => s.id === sectionId) ?? sections[0];
  const { data: elR } = elective ? await supabase.rpc("course_roster" as never, { p_subject: elective.subject_id } as never) : { data: [] };
  const elRoster = (elR ?? []) as unknown as { student_id: number; student_name: string; roll_no: number | null; section_id: number; section_label: string }[];
  const subjectIds = [...new Set([...section.subjects.map((x) => x.id), ...(elective ? [elective.subject_id] : [])])];
  const [roster, att, { data: partData }, { data: batchData }, { data: mineData }, { data: corrData }] = await Promise.all([
    getSectionStudents(section.id, year.id),
    supabase.rpc("course_attendance" as never, { p_section: section.id, p_student: null } as never),
    subjectIds.length ? supabase.from("subject").select("id, components" as "id").in("id", subjectIds) : Promise.resolve({ data: [] }),
    supabase.from("section_batch_member" as never).select("label, student_id").eq("section_id", section.id),
    supabase.from("teacher_allotment").select("id, staff_id, subject_id, component, batch, is_class_teacher, staff:staff_id(full_name)" as "id").eq("section_id", section.id).eq("academic_year_id", year.id),
    supabase.from("attendance_correction" as never).select("id, student_id, subject_id, on_date, period, reason, status, decision_note, subject:subject_id(name), student:student_id(full_name)").eq("status", "pending").order("created_at").limit(100),
  ]);
  const partsOf = new Map(((partData ?? []) as unknown as { id: number; components: string[] }[]).map((x) => [x.id, x.components]));
  const batchMap = new Map<string, number[]>();
  for (const b of (batchData ?? []) as unknown as { label: string; student_id: number }[]) batchMap.set(b.label, [...(batchMap.get(b.label) ?? []), b.student_id]);
  const batches = [...batchMap.entries()].sort().map(([label, ids]) => ({ label, ids }));
  const allot = (mineData ?? []) as unknown as { id: number; staff_id: number; subject_id: number; component: string | null; batch: string | null; is_class_teacher: boolean; staff: { full_name: string } | null }[];
  const isCt = allot.some((a) => a.staff_id === session.staffId && a.is_class_teacher);
  const allowed = scope.isAdmin ? undefined : allot.filter((a) => a.staff_id === session.staffId).map((a) => ({ subject_id: a.subject_id, component: a.component, batch: a.batch }));
  const inbox = ((corrData ?? []) as unknown as (Omit<Correction, "subject" | "student"> & { subject: { name: string } | null; student: { full_name: string } | null })[]).map((c) => ({ ...c, subject: c.subject?.name ?? null, student: c.student?.full_name ?? "" }));
  const view = one(sp.view);
  if (view === "setup" && (scope.isAdmin || isCt)) {
    const { data: staffData } = await supabase.from("staff").select("id, full_name").in("role", ["subject_teacher", "class_teacher", "principal"]).order("full_name").limit(1000);
    return (
      <div className="space-y-4">
        <PageHeader title="Lectures: set-up" description="Theory and practical parts of each subject, the section's lab batches, and which teacher takes which part or batch." />
        <Link href={`?section=${section.id}`} className="text-[13px] font-medium text-[#0F6CBD] hover:underline">Back to marking</Link>
        <div className="flex flex-wrap gap-1.5">{sections.map((s) => (
          <Link key={s.id} href={`?section=${s.id}&view=setup`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === section.id ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{s.label}</Link>))}</div>
        <PartsSetup sectionId={section.id} sectionLabel={section.label} canSubjects={scope.isAdmin}
          subjects={section.subjects.map((x) => ({ id: x.id, name: x.name, parts: partsOf.get(x.id) ?? ["theory"] }))}
          roster={roster.map((r) => ({ id: r.id, name: r.name, roll: r.roll }))} batches={batches}
          allotments={allot.filter((a) => a.component && !a.is_class_teacher).map((a) => ({ id: a.id, staff: a.staff?.full_name ?? "", subject_id: a.subject_id, component: a.component!, batch: a.batch }))}
          staff={((staffData ?? []) as { id: number; full_name: string }[]).map((x) => ({ id: x.id, name: x.full_name }))} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Lectures" description={`${sem.kind === "odd" ? "Odd" : "Even"} semester. Mark each lecture; percentages below ${minimum}% are a shortage.`} />
      {electives.length > 0 && <div className="flex flex-wrap gap-1.5">{electives.map((e) => (
        <Link key={e.subject_id} href={`?elective=${e.subject_id}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${e.subject_id === electiveId ? "border-[#0F6CBD] bg-[#EBF3FC] text-[#0F6CBD]" : "border-hair bg-white text-ink-700"}`}>Elective: {e.subject_name} ({e.sections} sections)</Link>))}</div>}
      {(scope.isAdmin || isCt) && <Link href={`?section=${section.id}&view=setup`} className="text-[13px] font-medium text-[#0F6CBD] hover:underline">Set-up: theory and practical, lab batches, teachers per part</Link>}
      <CorrectionsInbox rows={inbox} />
      <div className="flex flex-wrap gap-1.5">{sections.map((s) => (
        <Link key={s.id} href={`?section=${s.id}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === section.id ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700 hover:bg-panel"}`}>{s.label}</Link>))}
      </div>
      {elective ? (
        <LectureMarker key={`el-${elective.subject_id}`} sectionId={elRoster[0]?.section_id ?? section.id} subjects={[{ id: elective.subject_id, name: elective.subject_name, parts: partsOf.get(elective.subject_id) }]} electiveSubject={elective.subject_id}
          roster={elRoster.map((r) => ({ id: r.student_id, name: r.student_name, roll: r.roll_no, section: r.section_label }))} lockNote={lockNote} />
      ) : <>
      {section.subjects.length === 0 && <p className="text-[13px] text-ink-700">Attendance shortage for {section.label}. Lectures are marked by the course teachers.</p>}
      {section.subjects.length > 0 && <LectureMarker key={section.id} sectionId={section.id} subjects={section.subjects.map((x) => ({ id: x.id, name: x.name, parts: partsOf.get(x.id) }))} roster={roster.map((r) => ({ id: r.id, name: r.name, roll: r.roll }))} lockNote={lockNote} batches={batches} allowed={allowed} />}
      </>}
      <AttendanceShortage rows={(att.data ?? []) as unknown as AttRow[]} minimum={minimum} waiting={waiting} />
    </div>
  );
}
