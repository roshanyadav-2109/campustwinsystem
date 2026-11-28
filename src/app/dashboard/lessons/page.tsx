import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession, getCurrentYear } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getMyChildren } from "@/lib/data/analytics";
import { Feed, Progress, TeacherLessons, type FeedRow, type ProgressRow } from "@/components/lessons/lessons";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
type Pair = { section_id: number; subject_id: number; label: string; class_id: number | null };

// Lessons: for each subject, what every lecture covered, the material shared, and how far the syllabus has got.
// Teachers log lessons and keep the syllabus; students and parents follow along.
export default async function LessonsPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/lessons");
  if (denied) return denied;
  const [session, year, sp] = await Promise.all([getSession(), getCurrentYear(), searchParams]);
  if (!session || !year) return null;
  const supabase = await createClient();
  const isStaff = session.role === "staff";
  let student: number | null = null, kids: { id: number; name: string }[] = [];
  let pairs: Pair[] = [];
  if (isStaff) {
    // the teacher's own subjects; the office and the head can open any section's subjects
    const q = supabase.from("teacher_allotment").select("section_id, subject_id, section:section_id(name, class_id, class:class_id(name)), subject:subject_id(name)").eq("academic_year_id", year.id).not("subject_id", "is", null);
    const { data } = session.isAdminScope ? await q.limit(2000) : await q.eq("staff_id", session.staffId ?? 0);
    pairs = ((data ?? []) as unknown as { section_id: number; subject_id: number; section: { name: string; class_id: number; class: { name: string } | null } | null; subject: { name: string } | null }[])
      .map((r) => ({ section_id: r.section_id, subject_id: r.subject_id, class_id: r.section?.class_id ?? null, label: `${r.subject?.name ?? ""} · ${r.section?.class?.name ?? ""}-${r.section?.name ?? ""}` }));
  } else {
    if (session.role === "guardian") { kids = (await getMyChildren()).map((k) => ({ id: k.id, name: k.full_name })); student = Number(one(sp.child)) || kids[0]?.id || null; }
    else student = session.studentId;
    if (student) {
      const { data } = await supabase.rpc("lesson_subjects" as never, { p_student: student } as never);
      pairs = ((data ?? []) as unknown as { section_id: number; subject_id: number; subject: string; class_id: number }[]).map((r) => ({ section_id: r.section_id, subject_id: r.subject_id, class_id: r.class_id, label: r.subject }));
    }
  }
  const uniq = [...new Map(pairs.map((p) => [`${p.section_id}:${p.subject_id}`, p])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const key = one(sp.p);
  const cur = uniq.find((p) => `${p.section_id}:${p.subject_id}` === key) ?? uniq[0];
  const [{ data: feed }, { data: prog }] = cur
    ? await Promise.all([
        supabase.rpc("lesson_feed" as never, { p_section: cur.section_id, p_subject: cur.subject_id, p_student: student } as never),
        supabase.rpc("syllabus_progress" as never, { p_section: cur.section_id, p_subject: cur.subject_id } as never),
      ])
    : [{ data: [] }, { data: [] }];
  const teaches = isStaff && !!cur && (session.isAdminScope || pairs.some((p) => p.section_id === cur.section_id && p.subject_id === cur.subject_id));
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const qs = (p: Pair) => `?p=${p.section_id}:${p.subject_id}${student && session.role === "guardian" ? `&child=${student}` : ""}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Lessons" description={isStaff ? "Log what each lecture covered and share the material; students and parents see it, with the syllabus covered so far." : "What each lecture covered, the material shared, and how much of the syllabus is done."} />
      {kids.length > 1 && <div className="flex flex-wrap gap-1.5">{kids.map((k) => <Link key={k.id} href={`?child=${k.id}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${k.id === student ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{k.name}</Link>)}</div>}
      {uniq.length === 0 ? <p className="text-[13px] text-ink-500">{isStaff ? "No subjects are allotted to you this year." : "No subjects found for this year yet."}</p> : <>
        <div className="flex flex-wrap gap-1.5">{uniq.slice(0, 60).map((p) => (
          <Link key={`${p.section_id}:${p.subject_id}`} href={qs(p)} className={`rounded-sm border px-2.5 py-1 text-[13px] ${p === cur ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{p.label}</Link>))}</div>
        {cur && <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {teaches && <TeacherLessons key={`${cur.section_id}:${cur.subject_id}`} sectionId={cur.section_id} subjectId={cur.subject_id} classId={cur.class_id} progress={(prog ?? []) as unknown as ProgressRow[]} today={today}
              otherSections={session.isAdminScope ? [] : uniq.filter((p) => p.subject_id === cur.subject_id && p.section_id !== cur.section_id).map((p) => ({ id: p.section_id, label: p.label }))} />}
            <Card><CardHeader title="Lessons so far" /><CardBody><Feed rows={(feed ?? []) as unknown as FeedRow[]} canEdit={teaches} showAttendance={!isStaff} /></CardBody></Card>
          </div>
          {!teaches && <Card><CardHeader title="Syllabus" /><CardBody><Progress rows={(prog ?? []) as unknown as ProgressRow[]} /></CardBody></Card>}
        </div>}
      </>}
    </div>
  );
}
