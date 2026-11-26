import Link from "next/link";
import { guardTab } from "@/lib/access";
import { getCurrentYear, getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope } from "@/lib/data/scope";
import { getMyChildren } from "@/lib/data/analytics";
import { ReportCardsDesk, FamilyCards, type DeskRow, type AreaOpt } from "@/components/report-cards/desk";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const BASE_PATH = "/dashboard/report-cards";

export default async function ReportCardsPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab(BASE_PATH);
  if (denied) return denied;
  const [session, year, sp] = await Promise.all([getSession(), getCurrentYear(), searchParams]);
  if (!session || !year) return <EmptyState art="error" title="No current school year is set" />;
  const supabase = await createClient();

  // ---------- parents and students: published cards ----------
  if (session.role === "guardian" || session.role === "student") {
    const kids = session.role === "guardian" ? await getMyChildren() : [];
    const ids = session.role === "guardian" ? kids.map((k) => k.id) : session.studentId ? [session.studentId] : [];
    const { data } = await supabase.from("report_card" as never).select("id, student_id, term, snapshot, verify_token, published_at")
      .in("student_id", ids.length ? ids : [0]).eq("status", "published").order("published_at", { ascending: false }).limit(100);
    const cards = ((data ?? []) as unknown as { id: number; student_id: number; term: number; snapshot: Record<string, unknown>; verify_token: string; published_at: string }[]);
    return (
      <div className="space-y-4">
        <PageHeader title="Report cards" description="Report cards the school has published. Download and keep a copy." />
        {cards.length === 0
          ? <EmptyState art="no-marks" title="No report cards yet" hint="When the school publishes a report card, it appears here and you get a notification." />
          : <FamilyCards cards={cards.map((c) => ({ id: c.id, snapshot: c.snapshot, token: c.verify_token, publishedAt: c.published_at }))} />}
      </div>
    );
  }

  // ---------- staff ----------
  const scope = await getStaffScope();
  const sections = scope.isAdmin
    ? scope.sections.map((s) => ({ id: s.id, label: `${s.class_name}-${s.name}`, level: s.class_level }))
    : scope.sectionMeta.filter((m) => m.isClassTeacher).map((m) => ({ id: m.id, label: m.label, level: m.classLevel }));
  sections.sort((a, b) => a.level - b.level || a.label.localeCompare(b.label));
  if (!sections.length) return (<div><PageHeader title="Report cards" /><EmptyState art="no-sections" title="No sections to show" hint="Report cards are prepared by class teachers and the office." /></div>);
  const sectionId = Number(one(sp.section)) || sections[0].id;
  const section = sections.find((s) => s.id === sectionId) ?? sections[0];

  const { data: schemeId } = await supabase.rpc("report_scheme_for" as never, { p_section: section.id, p_year: year.id } as never);
  const picker = (
    <div className="flex flex-wrap gap-1.5" role="navigation" aria-label="Choose a section">
      {sections.map((s) => (
        <Link key={s.id} href={`${BASE_PATH}?section=${s.id}`}
          className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.id === section.id ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700 hover:bg-panel"}`}>{s.label}</Link>
      ))}
    </div>
  );
  if (!schemeId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Report cards" />
        {picker}
        <EmptyState art="coming-soon" title={`No report card scheme for ${section.label} yet`}
          hint={session.staffRole === "office" ? "Choose one in Settings, Report cards." : "Ask the office to choose a report card scheme for this class."}>
          {session.staffRole === "office" && <Link className="text-[14px] font-medium text-[#0F6CBD] hover:underline" href="/dashboard/settings/report-cards">Open Settings, Report cards</Link>}
        </EmptyState>
      </div>
    );
  }

  const [termsRes, areasRes, lockRes] = await Promise.all([
    supabase.from("report_scheme_term" as never).select("term, name").eq("scheme_id", schemeId as unknown as number).order("term"),
    supabase.from("report_coscholastic_area" as never).select("id, name, grades").eq("scheme_id", schemeId as unknown as number).order("sort"),
    supabase.from("report_lock" as never).select("term").eq("section_id", section.id).eq("academic_year_id", year.id),
  ]);
  const terms = ((termsRes.data ?? []) as unknown as { term: number; name: string }[]);
  const termTabs = [...terms, { term: 0, name: "Year-end result" }];
  const t = (() => { const v = Number(one(sp.term)); return termTabs.some((x) => x.term === v) ? v : terms[0]?.term ?? 0; })();
  const locked = new Set(((lockRes.data ?? []) as unknown as { term: number }[]).map((l) => l.term));
  const termLocked = t === 0 ? terms.every((x) => locked.has(x.term)) : locked.has(t);

  const [reportRes, cardsRes, gradesRes, remarksRes, attRes] = await Promise.all([
    supabase.rpc("compute_report" as never, { p_section: section.id, p_year: year.id, p_term: t } as never),
    supabase.from("report_card" as never).select("id, student_id, published_at").eq("section_id", section.id).eq("academic_year_id", year.id).eq("term", t).eq("status", "published"),
    supabase.from("report_coscholastic_grade" as never).select("student_id, area_id, grade").eq("academic_year_id", year.id).eq("term", t === 0 ? -1 : t),
    supabase.from("report_remark" as never).select("student_id, remark, result_text").eq("academic_year_id", year.id).eq("term", t),
    supabase.from("report_attendance" as never).select("student_id, present, working").eq("academic_year_id", year.id).eq("term", t),
  ]);
  if (reportRes.error) return (<div className="space-y-4"><PageHeader title="Report cards" />{picker}<EmptyState art="error" title="Could not prepare report cards" hint={reportRes.error.message} /></div>);
  const published = new Map(((cardsRes.data ?? []) as unknown as { id: number; student_id: number; published_at: string }[]).map((c) => [c.student_id, c]));
  const grades = (gradesRes.data ?? []) as unknown as { student_id: number; area_id: number; grade: string }[];
  const remarks = new Map(((remarksRes.data ?? []) as unknown as { student_id: number; remark: string; result_text: string | null }[]).map((r) => [r.student_id, r]));
  const att = new Map(((attRes.data ?? []) as unknown as { student_id: number; present: number; working: number }[]).map((a) => [a.student_id, a]));
  const rows: DeskRow[] = ((reportRes.data ?? []) as unknown as { student_id: number; report: Record<string, unknown> }[]).map((r) => ({
    studentId: r.student_id, report: r.report,
    published: published.get(r.student_id) ? { id: published.get(r.student_id)!.id, at: published.get(r.student_id)!.published_at } : null,
    grades: Object.fromEntries(grades.filter((g) => g.student_id === r.student_id).map((g) => [g.area_id, g.grade])),
    remark: remarks.get(r.student_id)?.remark ?? "", resultText: remarks.get(r.student_id)?.result_text ?? "",
    present: att.get(r.student_id)?.present?.toString() ?? "", working: att.get(r.student_id)?.working?.toString() ?? "",
  }));
  const areas: AreaOpt[] = ((areasRes.data ?? []) as unknown as AreaOpt[]);

  return (
    <div className="space-y-4">
      <PageHeader title="Report cards" description={`${section.label}, ${year.name}. Check the results, add grades and remarks, lock the marks, then publish.`} />
      {picker}
      <div className="flex flex-wrap gap-1.5" role="navigation" aria-label="Choose a term">
        {termTabs.map((x) => (
          <Link key={x.term} href={`${BASE_PATH}?section=${section.id}&term=${x.term}`}
            className={`rounded-sm border px-2.5 py-1 text-[13px] ${x.term === t ? "border-[#0F6CBD] bg-[#EBF3FC] text-[#0F6CBD]" : "border-hair bg-white text-ink-700 hover:bg-panel"}`}>
            {x.name}{x.term !== 0 && locked.has(x.term) ? " (locked)" : ""}</Link>
        ))}
      </div>
      <Card>
        <CardHeader title={termTabs.find((x) => x.term === t)?.name ?? ""} />
        <CardBody className="p-0">
          <ReportCardsDesk sectionId={section.id} term={t} termLocked={termLocked} canUnlock={session.staffRole === "office"}
            rows={rows} areas={t === 0 ? [] : areas} isFinal={t === 0} verifyBase={`https://verify.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}/verify/`} />
        </CardBody>
      </Card>
    </div>
  );
}
