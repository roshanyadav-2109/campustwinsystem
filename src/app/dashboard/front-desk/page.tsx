import { MedicineDesk, FamilyMedicines, type DueDose, type MedicineRow, type DoseRow } from "@/components/front-desk/medicines";
import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getMyChildren } from "@/lib/data/analytics";
import { VisitorsDesk, GatePassDesk, HealthDesk, FamilyFrontDesk, type VisitorRow, type PassRow, type HealthRow } from "@/components/front-desk/front-desk";

type SP = Promise<Record<string, string | string[] | undefined>>;
const startOfTodayIST = () => { const d = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); return `${d}T00:00:00+05:30`; };

// Front desk: visitors, early pick-up (gate passes) and the health room.
export default async function FrontDeskPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/front-desk");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const passSel = "id, student_id, reason, pickup_name, pickup_relation, pickup_phone, leave_at, status, decision_note, left_at, created_at, student:student_id(full_name, admission_no)";
  const healthSel = "id, student_id, visited_at, complaint, action_taken, sent_home, student:student_id(full_name)";

  if (session?.role === "guardian" || session?.role === "student") {
    const kids = session.role === "guardian" ? (await getMyChildren()).map((k) => ({ id: k.id, name: k.full_name })) : [];
    const [passes, visits, meds, doses] = await Promise.all([
      supabase.from("gate_pass" as never).select(passSel).order("leave_at", { ascending: false }).limit(50),
      supabase.from("health_visit" as never).select(healthSel).order("visited_at", { ascending: false }).limit(50),
      supabase.from("student_medicine" as never).select("id, student_id, medicine, dose, times, from_date, to_date, instructions, doctor, status").eq("status", "active").order("from_date", { ascending: false }).limit(50),
      supabase.from("medicine_dose" as never).select("id, medicine_id, due_on, due_at, status, note, given_at").order("given_at", { ascending: false }).limit(50),
    ]);
    return (
      <div className="space-y-4">
        <PageHeader title="Pick-up and health" description="Ask the school for an early pick-up, and see visits to the health room." />
        <FamilyFrontDesk kids={kids} passes={(passes.data ?? []) as unknown as PassRow[]} visits={(visits.data ?? []) as unknown as HealthRow[]} />
        {session.role === "guardian" && <FamilyMedicines kids={kids} active={(meds.data ?? []) as unknown as MedicineRow[]} doses={(doses.data ?? []) as unknown as DoseRow[]} />}
      </div>
    );
  }

  const sp = await searchParams;
  const view = (Array.isArray(sp.view) ? sp.view[0] : sp.view) ?? "visitors";
  const tab = (v: string, label: string) => <Link href={`?view=${v}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${view === v ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700 hover:bg-panel"}`}>{label}</Link>;
  let body;
  if (view === "passes") {
    const { data } = await supabase.from("gate_pass" as never).select(passSel).gte("leave_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("leave_at", { ascending: false }).limit(500);
    body = <GatePassDesk passes={(data ?? []) as unknown as PassRow[]} />;
  } else if (view === "medicines") {
    const [{ data: due }, { data: active }] = await Promise.all([
      supabase.rpc("medicine_due" as never),
      supabase.from("student_medicine" as never).select("id, student_id, medicine, dose, times, from_date, to_date, instructions, doctor, status, student:student_id(full_name)").eq("status", "active").gte("to_date", new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)).order("to_date").limit(300),
    ]);
    body = <MedicineDesk due={(due ?? []) as unknown as DueDose[]} active={(active ?? []) as unknown as MedicineRow[]} />;
  } else if (view === "health") {
    const { data } = await supabase.from("health_visit" as never).select(healthSel).gte("visited_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("visited_at", { ascending: false }).limit(500);
    body = <HealthDesk visits={(data ?? []) as unknown as HealthRow[]} />;
  } else {
    const [today, open] = await Promise.all([
      supabase.from("visitor" as never).select("id, name, phone, purpose, meeting, badge_no, in_at, out_at").gte("in_at", startOfTodayIST()).order("in_at", { ascending: false }).limit(500),
      supabase.from("visitor" as never).select("id, name, phone, purpose, meeting, badge_no, in_at, out_at").is("out_at", null).lt("in_at", startOfTodayIST()).limit(100),
    ]);
    body = <VisitorsDesk today={(today.data ?? []) as unknown as VisitorRow[]} stillIn={(open.data ?? []) as unknown as VisitorRow[]} />;
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Front desk" description="Visitors in and out, early pick-ups and the health room. Parents are told about pick-ups, health visits and medicines given." />
      <div className="flex gap-1.5">{tab("visitors", "Visitors")}{tab("passes", "Gate passes")}{tab("health", "Health room")}{tab("medicines", "Medicines")}</div>
      {body}
    </div>
  );
}
