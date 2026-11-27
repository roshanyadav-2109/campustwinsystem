import { createClient } from "@/lib/supabase/server";
import { getCurrentYear, type Session } from "@/lib/session";
import { todayIST } from "@/components/fees/shared";
import { moduleOn } from "@/core/routes";
import { canOpen } from "@/lib/nav";

// What is waiting for the office or the principal today. Each item is a count
// plus where to go; items with nothing waiting are left out.
export type TodoItem = { key: string; count: number; href: string };

export async function getTodo(session: Session): Promise<TodoItem[]> {
  const year = await getCurrentYear();
  if (!year) return [];
  const supabase = await createClient();
  const mods = session.school.modules;
  const today = todayIST();
  const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;

  const [sections, marked, holiday, draft, enquiries, overdue, letters] = await Promise.all([
    supabase.from("section").select("id", { count: "exact", head: true }),
    supabase.rpc("sections_marked_on" as never, { p_date: today } as never),
    supabase.from("event").select("id, class_id, section_id").eq("event_type", "holiday").lte("start_date", today).gte("end_date", today),
    supabase.from("assessment").select("id", { count: "exact", head: true }).eq("academic_year_id", year.id).eq("is_published", false),
    moduleOn("admissions", mods) ? supabase.from("admission_enquiry").select("id", { count: "exact", head: true }).eq("status", "new") : Promise.resolve({ count: 0 }),
    moduleOn("fees", mods) ? supabase.from("fee_invoice" as never).select("id", { count: "exact", head: true }).eq("academic_year_id", year.id).in("status", ["due", "part"]).lt("due_date", today) : Promise.resolve({ count: 0 }),
    moduleOn("fees", mods) && session.school.higherEd && session.staffRole === "office"
      ? supabase.from("fee_letter_request" as never).select("id", { count: "exact", head: true }).eq("status", "pending") : Promise.resolve({ count: 0 }),
  ]);

  // Attendance: only on a working day that is not a whole-school holiday.
  const wholeHoliday = ((holiday.data ?? []) as { class_id: number | null; section_id: number | null }[]).some((e) => !e.class_id && !e.section_id);
  const markedSections = Number(marked.data ?? 0);
  const unmarked = sunday || wholeHoliday ? 0 : Math.max(0, (sections.count ?? 0) - markedSections);

  const items: TodoItem[] = [
    { key: "attendance", count: unmarked, href: "/dashboard/attendance" },
    { key: "marks", count: draft.count ?? 0, href: "/dashboard/marks" },
    { key: "enquiries", count: enquiries.count ?? 0, href: "/dashboard/admissions" },
    { key: "overdue", count: overdue.count ?? 0, href: "/dashboard/fees?view=dues" },
    { key: "letters", count: letters.count ?? 0, href: "/dashboard/fees?view=letters" },
  ];
  // Only work this person can open.
  return items.filter((i) => i.count > 0 && canOpen(session.navRole, i.href.split("?")[0], mods, session.school.edition, session.accessTypes));
}
