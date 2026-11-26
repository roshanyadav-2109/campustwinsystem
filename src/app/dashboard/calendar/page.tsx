import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/i18n/server";
import { PageHeader } from "@/components/ui/page-header";
import { MonthCalendar, type CalItem } from "@/components/calendar/month-calendar";
import { EventManager, type ClassOpt, type ManagedEvent } from "@/components/calendar/event-manager";
import { guardTab } from "@/lib/access";

// Every date from start to end, inclusive (capped so a typo can't flood the grid).
function eachDay(from: string, to: string | null): string[] {
  const out: string[] = [];
  const end = to && to >= from ? to : from;
  for (let d = new Date(`${from}T00:00:00Z`); out.length < 120; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    out.push(iso);
    if (iso >= end) break;
  }
  return out;
}

export default async function CalendarPage() {
  const denied = await guardTab("/dashboard/calendar");
  if (denied) return denied;
  const session = (await getSession())!;
  const supabase = await createClient();
  const { t } = await getT();
  const isLeader = session.staffRole === "principal" || session.staffRole === "office";

  const items: CalItem[] = [];

  // Events — visible to everyone in scope (RLS). A holiday or exam that runs
  // over several days shows on each of them.
  const { data: events } = await supabase.from("event")
    .select("id, title, event_type, start_date, end_date, class_id, section_id, description")
    .order("start_date");
  for (const e of events ?? []) for (const d of eachDay(e.start_date, e.end_date)) items.push({ date: d, kind: e.event_type, label: e.title });

  // Staff also see assessment/exam windows for their sections (deduped).
  if (session.role !== "student" && session.role !== "guardian") {
    const { data: assess } = await supabase.from("assessment").select("assessed_on, name");
    const seen = new Set<string>();
    for (const a of assess ?? []) {
      const key = `${a.assessed_on}|${a.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ date: a.assessed_on, kind: "exam", label: a.name });
    }
  }

  // Open on this month.
  const defaultMonth = new Date().toISOString().slice(0, 7);

  let manager: React.ReactNode = null;
  if (isLeader) {
    const [{ data: classes }, { data: sections }] = await Promise.all([
      supabase.from("class").select("id, name, level").order("level").order("name"),
      supabase.from("section").select("id, class_id, name").order("name"),
    ]);
    const classOpts: ClassOpt[] = (classes ?? []).map((c) => ({
      id: c.id, name: c.name,
      sections: (sections ?? []).filter((s) => s.class_id === c.id).map((s) => ({ id: s.id, name: s.name })),
    }));
    const managed: ManagedEvent[] = (events ?? []).map((e) => ({
      id: e.id, title: e.title, kind: e.event_type, from: e.start_date, to: e.end_date ?? e.start_date,
      classId: e.class_id, sectionId: e.section_id, description: e.description,
    }));
    manager = <div className="mt-6"><EventManager events={managed} classes={classOpts} /></div>;
  }

  return (
    <div>
      <PageHeader title={t("announce.events")} />
      <MonthCalendar items={items} defaultMonth={defaultMonth} />
      {manager}
    </div>
  );
}
