import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { RelaxationList, FeeExtensionForm, HoldsList, type RelaxRow, type HoldRow } from "@/components/courses/relaxations";

// Attendance relaxation, fee extension and unlock requests, with their approval steps.
export default async function RelaxationsPage() {
  const denied = await guardTab("/dashboard/relaxations");
  if (denied) return denied;
  const session = await getSession();
  if (!session) return null;
  const supabase = await createClient();
  const { data: sch } = await supabase.from("school").select("relax_chain" as "id").eq("id", session.schoolId).maybeSingle();
  const { data } = await supabase.from("relaxation_request" as never)
    .select("id, kind, status, step, chain, requested_by, reason, until, on_date, created_at, semester_id, student_id, subject_id, section_id, student:student_id(full_name, admission_no), subject:subject_id(name), section:section_id(name, class:class_id(name)), steps:relaxation_step(step_no, as_type, decision, note, at, staff_id, staff:staff_id(full_name))")
    .order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as unknown as RelaxRow[];
  const deciders = [...new Set(rows.flatMap((r) => r.steps.map((x) => x.staff_id)).filter(Boolean))] as number[];
  if (deciders.length) {
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: pos } = await supabase.from("staff_position" as never).select("staff_id, starts_on, ends_on, title:title_id(name, sort)").in("staff_id", deciders);
    const t = new Map<number, string>();
    for (const p of (pos ?? []) as unknown as { staff_id: number; starts_on: string; ends_on: string | null; title: { name: string } | null }[])
      if (p.title && p.starts_on <= today && (!p.ends_on || p.ends_on >= today) && !t.has(p.staff_id)) t.set(p.staff_id, p.title.name);
    for (const r of rows) for (const x of r.steps) if (x.staff && x.staff_id && t.has(x.staff_id)) x.staff.full_name = `${x.staff.full_name} (${t.get(x.staff_id)})`;
  }
  if (!session.staffRole) return null;

  // requests waiting for the caller, and the students held back this semester
  const [{ data: q }, { data: lab }, { data: holds }] = await Promise.all([
    supabase.rpc("my_relaxation_queue" as never),
    supabase.rpc("chain_labels" as never),
    supabase.rpc("current_holds" as never, { p_section: null } as never),
  ]);
  // a set-returning function comes back as [{ my_relaxation_queue: id }]
  const mine = new Set(((q ?? []) as unknown as (number | Record<string, number>)[]).map((x) => Number(typeof x === "object" ? Object.values(x)[0] : x)));
  const chain = (sch as unknown as { relax_chain: Record<string, string[]> } | null)?.relax_chain ?? {};
  return (
    <div className="space-y-4">
      <PageHeader title="Relaxations" description="Attendance relaxation, fee extensions and unlocking locked attendance, raised by staff. Each request passes through the people the institution has chosen, in order." />
      {session.staffRole === "office" && <FeeExtensionForm />}
      <RelaxationList title="Waiting for you" rows={rows.filter((r) => mine.has(r.id))} canAct chain={chain} labels={(lab ?? {}) as unknown as Record<string, string | null>} me={session.userId} canRevoke={false} empty="Nothing is waiting for you." />
      <HoldsList rows={(holds ?? []) as unknown as HoldRow[]} />
      <RelaxationList title="All requests" rows={rows.filter((r) => !mine.has(r.id))} chain={chain} labels={(lab ?? {}) as unknown as Record<string, string | null>} me={session.userId} canRevoke={session.staffRole === "office" || session.staffRole === "principal"} empty="No requests yet." />
    </div>
  );
}
