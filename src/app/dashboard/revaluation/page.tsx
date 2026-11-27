import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { isExams } from "@/lib/roles";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { RevaluationDesk, type RevalRow } from "@/components/courses/revaluation";

// Revaluation and retotalling requests (colleges and universities): the exam cell decides.
export default async function RevaluationPage() {
  const denied = await guardTab("/dashboard/revaluation");
  if (denied) return denied;
  const session = await getSession();
  if (!session || !isExams(session)) return <EmptyState art="no-results" title="For the exam cell" />;
  const supabase = await createClient();
  const [{ data }, { data: pub }] = await Promise.all([
    supabase.from("reval_request" as never)
      .select("id, kind, status, old_ese, new_ese, old_grade, new_grade, note, created_at, invoice:invoice_id(status, amount, paid_amount), student:student_id(full_name, admission_no), result:result_id(ese, ese_max, attempt, course:course_id(code, name))")
      .order("created_at", { ascending: false }).limit(300),
    supabase.rpc("can_publish_results" as never),
  ]);
  const rows = (data ?? []) as unknown as RevalRow[];
  return (
    <div className="space-y-4">
      <PageHeader title="Revaluation" description="Requests from students for revaluation (the answer script marked again) or retotalling (the marks added up again). A revised result replaces the issued one; the earlier one is kept on record." />
      <RevaluationDesk rows={rows} canDecide={pub === true} />
    </div>
  );
}
