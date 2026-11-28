import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession, getCurrentYear } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope } from "@/lib/data/scope";
import { getPeriods, getTeachingStaff, untyped } from "@/lib/data/schedule";
import { TimetableGenerator, type GenData } from "@/components/schedule/generator";

// Timetable generator: what each class needs per week, teachers' unavailable periods, the rules,
// then a whole-school week made in the browser, previewed and saved in one step.
export default async function GeneratePage() {
  const denied = await guardTab("/dashboard/schedule");
  if (denied) return denied;
  const [session, year, bell] = await Promise.all([getSession(), getCurrentYear(), getPeriods()]);
  if (!session?.isAdminScope) return <EmptyState art="no-access" title="The timetable is made by the school office" />;
  if (!year) return <EmptyState art="nothing-yet" title="No school year is open yet" />;
  if (bell.missing || !bell.periods.length) return (
    <div><PageHeader title="Generate timetable" /><EmptyState art="nothing-yet" title="Set the bell times first" hint="Schedule, Bell times: the periods of the day and the breaks." /></div>
  );
  const supabase = await createClient();
  const db = await untyped();
  const [scope, teachers, loads, allot, unavail, rules] = await Promise.all([
    getStaffScope(), getTeachingStaff(),
    db.from("timetable_load").select("class_id, subject_id, periods, double_period, max_per_day").eq("academic_year_id", year.id),
    supabase.from("teacher_allotment").select("section_id, subject_id, staff_id, is_class_teacher").eq("academic_year_id", year.id).limit(10000),
    db.from("staff_unavailable").select("staff_id, day_of_week, period_no").limit(10000),
    supabase.from("school").select("tt_days, tt_teacher_max_day, tt_class_teacher_first" as "id").eq("id", session.schoolId).maybeSingle(),
  ]);
  const slots: GenData["slots"] = [];
  for (let from = 0; from < 30000; from += 1000) {
    const { data } = await db.from("timetable_slot").select("section_id, day_of_week, period_no, subject_id, staff_id").eq("academic_year_id", year.id).range(from, from + 999);
    const page = (data ?? []) as unknown as GenData["slots"];
    slots.push(...page);
    if (page.length < 1000) break;
  }
  const r = rules.data as unknown as { tt_days: number[]; tt_teacher_max_day: number; tt_class_teacher_first: boolean } | null;
  const data: GenData = {
    yearId: year.id, yearName: year.name,
    periods: bell.periods.map((p) => ({ no: p.period_no, label: p.label, isBreak: p.is_break, start: p.start_time })),
    classes: scope.classes.map((c) => ({ id: c.id, name: c.name, subjects: (scope.subjectsByClass[c.id] ?? []).map((s) => ({ id: s.id, name: s.name, code: s.code })) })),
    sections: scope.sections.map((s) => ({ id: s.id, label: `${s.class_name}-${s.name}`, classId: s.class_id })),
    teachers,
    loads: (loads.data ?? []) as unknown as GenData["loads"],
    allotments: (allot.data ?? []) as unknown as GenData["allotments"],
    unavailable: (unavail.data ?? []) as unknown as GenData["unavailable"],
    slots,
    rules: { days: r?.tt_days ?? [1, 2, 3, 4, 5, 6], teacherMaxDay: r?.tt_teacher_max_day ?? 6, classTeacherFirst: r?.tt_class_teacher_first ?? true },
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Generate timetable" description={`Set how many periods each subject needs, when teachers are not available and the rules; then make the week for ${year.name}, check it and save.`} />
      <Link href="/dashboard/schedule" className="text-[13px] font-medium text-[#0F6CBD] hover:underline">Back to the schedule</Link>
      <TimetableGenerator data={data} canEdit={session.staffRole === "office"} />
    </div>
  );
}
