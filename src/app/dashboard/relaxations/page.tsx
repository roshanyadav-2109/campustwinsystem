import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope } from "@/lib/data/scope";
import { RelaxationList, FeeExtensionForm, type RelaxRow } from "@/components/courses/relaxations";

// Attendance relaxation, fee extension and unlock requests, with their approval steps.
export default async function RelaxationsPage() {
  const denied = await guardTab("/dashboard/relaxations");
  if (denied) return denied;
  const session = await getSession();
  if (!session) return null;
  const supabase = await createClient();
  const { data: sch } = await supabase.from("school").select("relax_chain" as "id").eq("id", session.schoolId).maybeSingle();
  const { data } = await supabase.from("relaxation_request" as never)
    .select("id, kind, status, step, chain, reason, until, on_date, created_at, semester_id, student_id, subject_id, section_id, student:student_id(full_name, admission_no), subject:subject_id(name), section:section_id(name, class:class_id(name)), steps:relaxation_step(step_no, as_type, decision, note, at, staff:staff_id(full_name))")
    .order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as unknown as RelaxRow[];
  if (!session.staffRole) return null;

  // which pending requests the caller can decide now (the database checks again)
  let mine = new Set<number>();
  {
    const scope = await getStaffScope();
    const ctSections = new Set(scope.sectionMeta.filter((m) => m.isClassTeacher).map((m) => m.id));
    const ids = [...new Set(rows.filter((r) => r.status === "pending" && r.student_id).map((r) => r.student_id as number))];
    const { data: en } = ids.length ? await supabase.from("student_enrollment").select("student_id, section_id").in("student_id", ids).eq("status", "active") : { data: [] };
    const secOf = new Map((en ?? []).map((e) => [e.student_id, e.section_id]));
    mine = new Set(rows.filter((r) => {
      if (r.status !== "pending") return false;
      if (session.staffRole === "principal") return true;
      const t = r.chain[r.step];
      if (t === "office") return session.staffRole === "office";
      if (t === "advisor") return ctSections.has(r.section_id ?? secOf.get(r.student_id as number) ?? -1);
      return false;
    }).map((r) => r.id));
  }
  const chain = (sch as unknown as { relax_chain: Record<string, string[]> } | null)?.relax_chain ?? {};
  return (
    <div className="space-y-4">
      <PageHeader title="Relaxations" description="Attendance relaxation, fee extensions and unlocking locked attendance, raised by staff. Each request passes through the people the institution has chosen, in order." />
      {session.staffRole === "office" && <FeeExtensionForm />}
      <RelaxationList title="Waiting for you" rows={rows.filter((r) => mine.has(r.id))} canAct chain={chain} empty="Nothing is waiting for you." />
      <RelaxationList title="All requests" rows={rows.filter((r) => !mine.has(r.id))} chain={chain} empty="No requests yet." />
    </div>
  );
}
