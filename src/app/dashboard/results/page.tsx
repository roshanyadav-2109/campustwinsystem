import Link from "next/link";
import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope } from "@/lib/data/scope";
import { getMyChildren } from "@/lib/data/analytics";
import { ResultsDesk, MyResults, type PreviewRow } from "@/components/courses/results";
import { loadCards } from "@/lib/data/results";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Semester results: CIA + ESE per course, grades, SGPA and CGPA.
export default async function ResultsPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/results");
  if (denied) return denied;
  const [session, sp] = await Promise.all([getSession(), searchParams]);
  if (!session) return null;
  const supabase = await createClient();
  const verifyBase = `https://verify.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}/verify/`;
  // signature lines carry the institution's own titles
  const [{ data: coe }, { data: head }] = await Promise.all([
    supabase.rpc("signatory" as never, { p_type: "exams_head" } as never), supabase.rpc("signatory" as never, { p_type: "head" } as never)]);
  const signers = [((coe ?? []) as unknown as { title: string }[])[0]?.title ?? "Controller of Examinations", ((head ?? []) as unknown as { title: string }[])[0]?.title ?? "Principal"];

  if (session.role === "student" || session.role === "guardian") {
    const ids = session.role === "student" ? (session.studentId ? [session.studentId] : []) : (await getMyChildren()).map((k) => k.id);
    const cards = await loadCards(supabase, null, ids, session.school.name);
    const held = (await Promise.all(ids.map(async (id) => ((await supabase.rpc("my_result_holds" as never, { p_student: id } as never)).data ?? []) as unknown as { semester_no: number | null; reason: string }[]))).flat();
    return (
      <div className="space-y-4">
        <PageHeader title="Results" description="Published semester results, with SGPA and CGPA. Download the grade card." />
        {held.map((h, i) => <p key={i} role="status" className="rounded-sm border border-down bg-white px-3 py-2 text-[13px] text-down">Semester {h.semester_no ?? ""} result is held back: {h.reason}. Speak to the office.</p>)}
        {cards.length === 0 ? (held.length ? null : <EmptyState art="no-marks" title="No results published yet" />) : <MyResults cards={cards} verifyBase={verifyBase} signers={signers} />}
      </div>
    );
  }

  const { data: semData } = await supabase.from("semester" as never).select("id, kind, starts_on, ends_on, is_current").in("kind", ["odd", "even"]).order("starts_on", { ascending: false }).limit(12);
  const sems = (semData ?? []) as unknown as { id: number; kind: string; starts_on: string; ends_on: string; is_current: boolean }[];
  if (!sems.length) return (<div><PageHeader title="Results" /><EmptyState art="nothing-yet" title="No semesters yet" /></div>);
  const semId = Number(one(sp.semester)) || sems[0].id;
  const scope = await getStaffScope();
  const sections = scope.isAdmin ? scope.sections.map((s) => ({ id: s.id, label: `${s.class_name}-${s.name}` })) : scope.sectionMeta.filter((m) => m.isClassTeacher).map((m) => ({ id: m.id, label: m.label }));
  if (!sections.length) return (<div><PageHeader title="Results" /><EmptyState art="no-sections" title="No sections to show" /></div>);
  const sectionId = Number(one(sp.section)) || sections[0].id;
  const section = sections.find((s) => s.id === sectionId) ?? sections[0];
  const { data: prev, error } = await supabase.rpc("compute_course_results" as never, { p_semester: semId, p_section: section.id } as never);
  const ids = [...new Set(((prev ?? []) as unknown as PreviewRow[]).map((r) => r.student_id))];
  const { data: pub } = ids.length
    ? await supabase.from("semester_result" as never).select("student_id, sgpa, cgpa, withheld_reason").eq("semester_id", semId).in("student_id", ids)
    : { data: [] };
  const published = new Map(((pub ?? []) as unknown as { student_id: number; sgpa: number | null; cgpa: number | null; withheld_reason: string | null }[]).map((p) => [p.student_id, p]));
  const link = (q: Record<string, number>) => `?${new URLSearchParams({ semester: String(semId), section: String(section.id), ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) })}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Results" description="Internal (CIA) and end-semester (ESE) marks per course, grades, SGPA and CGPA. Publishing freezes them." />
      <div className="flex flex-wrap gap-1.5">{sems.map((s) => (
        <Link key={s.id} href={link({ semester: s.id })} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === semId ? "border-[#0F6CBD] bg-[#EBF3FC] text-[#0F6CBD]" : "border-hair bg-white text-ink-700"}`}>
          {s.kind === "odd" ? "Odd" : "Even"} semester {s.starts_on.slice(0, 4)}{s.is_current ? " (current)" : ""}</Link>))}
      </div>
      <div className="flex flex-wrap gap-1.5">{sections.map((s) => (
        <Link key={s.id} href={link({ section: s.id })} className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === section.id ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{s.label}</Link>))}
      </div>
      {error ? <EmptyState art="error" title="Could not prepare results" hint={error.message} /> : (
        <ResultsDesk key={`${semId}-${section.id}`} semesterId={semId} sectionId={section.id} rows={(prev ?? []) as unknown as PreviewRow[]}
          published={Object.fromEntries(published)} canPublish={session.staffRole === "office"} verifyBase={verifyBase} signers={signers} />
      )}
    </div>
  );
}
