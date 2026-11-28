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
  // every row, in pages of 1000 in a fixed order (a skipped row would otherwise be lost on save)
  async function all<T>(table: string, cols: string, filter: (q: ReturnType<ReturnType<typeof db.from>["select"]>) => ReturnType<ReturnType<typeof db.from>["select"]>, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data } = await filter(db.from(table).select(cols)).order(order).range(from, from + 999);
      const page = (data ?? []) as unknown as T[];
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }
  const y = year.id;
  const [scope, teachers, loads, allot, unavail, slots, groups, items, rules] = await Promise.all([
    getStaffScope(), getTeachingStaff(),
    all<GenData["loads"][number]>("timetable_load", "class_id, subject_id, periods, double_period, max_per_day, room", (q) => q.eq("academic_year_id", y), "class_id"),
    all<GenData["allotments"][number]>("teacher_allotment", "id, section_id, subject_id, staff_id, is_class_teacher", (q) => q.eq("academic_year_id", y), "id"),
    all<GenData["unavailable"][number]>("staff_unavailable", "staff_id, day_of_week, period_no", (q) => q, "staff_id"),
    all<GenData["slots"][number]>("timetable_slot", "id, section_id, day_of_week, period_no, subject_id, staff_id, room, group_id, extra:timetable_slot_extra(subject_id, staff_id)", (q) => q.eq("academic_year_id", y), "id"),
    all<{ id: number; label: string; section_ids: number[]; periods: number; double_period: boolean; max_per_day: number | null; room: string | null }>("timetable_group", "id, label, section_ids, periods, double_period, max_per_day, room", (q) => q.eq("academic_year_id", y), "id"),
    all<{ group_id: number; subject_id: number; staff_id: number | null }>("timetable_group_item", "group_id, subject_id, staff_id", (q) => q, "group_id"),
    supabase.from("school").select("tt_days, tt_teacher_max_day, tt_class_teacher_first, tt_day_periods, tt_blocked" as "id").eq("id", session.schoolId).maybeSingle(),
  ]);
  const r = rules.data as unknown as { tt_days: number[]; tt_teacher_max_day: number; tt_class_teacher_first: boolean; tt_day_periods: Record<string, number>; tt_blocked: { day: number; period: number }[] } | null;
  const data: GenData = {
    yearId: year.id, yearName: year.name,
    periods: bell.periods.map((p) => ({ no: p.period_no, label: p.label, isBreak: p.is_break, start: p.start_time })),
    classes: scope.classes.map((c) => ({ id: c.id, name: c.name, subjects: (scope.subjectsByClass[c.id] ?? []).map((s) => ({ id: s.id, name: s.name, code: s.code })) })),
    sections: scope.sections.map((s) => ({ id: s.id, label: `${s.class_name}-${s.name}`, classId: s.class_id })),
    teachers,
    loads, allotments: allot, unavailable: unavail, slots,
    groups: groups.map((g) => ({ id: g.id, label: g.label, sectionIds: g.section_ids, periods: g.periods, double: g.double_period, maxPerDay: g.max_per_day, room: g.room,
      items: items.filter((i) => i.group_id === g.id).map((i) => ({ subjectId: i.subject_id, staffId: i.staff_id })) })),
    rules: { days: r?.tt_days ?? [1, 2, 3, 4, 5, 6], teacherMaxDay: r?.tt_teacher_max_day ?? 6, classTeacherFirst: r?.tt_class_teacher_first ?? true,
      dayPeriods: Object.fromEntries(Object.entries(r?.tt_day_periods ?? {}).map(([k, v]) => [Number(k), Number(v)])), blocked: r?.tt_blocked ?? [] },
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Generate timetable" description={`Set how many periods each subject needs, when teachers are not available and the rules; then make the week for ${year.name}, check it and save.`} />
      <Link href="/dashboard/schedule" className="text-[13px] font-medium text-[#0F6CBD] hover:underline">Back to the schedule</Link>
      <TimetableGenerator data={data} canEdit={session.staffRole === "office"} />
    </div>
  );
}
