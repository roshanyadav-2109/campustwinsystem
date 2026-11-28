import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { switchCampus } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { CsvButton } from "@/components/courses/csv-button";
import { TransferRequests, type TransferRequestRow } from "@/components/university/transfer-requests";
import { CommonExam } from "@/components/university/common-exam";
import { UniversityChart, type UniChart } from "@/components/university/university-chart";
import { CentralTools, type ExamRow, type TransferRow } from "@/components/university/central-tools";

// Central university admin's cross-campus view: every campus of the university
// with headline counts, and a one-click switch into any campus (which scopes the
// rest of the app to it). Only a central admin (profile.university_id set) reaches
// this; everyone else is redirected to their normal dashboard.
export default async function UniversityPage() {
  const session = await getSession();
  if (!session) redirect("/auth/signout");
  if (!session.isUniversityAdmin || !session.university) redirect("/dashboard");

  const { university, campuses, activeCampusId } = session;
  const totalStudents = campuses.reduce((n, c) => n + c.students, 0);
  const totalStaff = campuses.reduce((n, c) => n + c.staff, 0);
  const supabase = await createClient();
  const [{ data: exams }, { data: transfers }, { data: uniStats }, { data: treq }, { data: uniChart }] = await Promise.all([
    supabase.rpc("university_exam_overview" as never),
    supabase.from("student_transfer" as never).select("id, done_at, carried, not_carried, from_school, to_school, student_name, admission_no, cgpa_before, cgpa_after").order("done_at", { ascending: false }).limit(20), supabase.rpc("university_statistics" as never),
    supabase.from("transfer_request" as never).select("id, status, reason, order_no, created_at, decided_at, from_school, to_school, student_id").order("created_at", { ascending: false }).limit(50),
    supabase.rpc("university_org_chart" as never)]);
  // names of students at other campuses come through central administration's own view
  const reqRows = (treq ?? []) as unknown as Omit<TransferRequestRow, "student">[];
  const { data: reqNames } = reqRows.length ? await supabase.rpc("transfer_request_students" as never) : { data: [] };
  const nameOf = new Map(((reqNames ?? []) as unknown as { id: number; full_name: string; admission_no: string }[]).map((x) => [x.id, x]));
  type CS = { campus: string; stats: { students: number; by_gender: Record<string, number>; by_category?: Record<string, number>; pwd?: number; staff: number; programmes: number; departments: number } };
  const campusStats = (uniStats ?? []) as unknown as CS[];
  const female = (g: Record<string, number>) => Object.entries(g).filter(([k]) => ["f", "female"].includes(k.toLowerCase())).reduce((a, [, v]) => a + v, 0);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6">
        <h1 className="t-h1 text-ink-900">{university.name}</h1>
        <p className="mt-1 text-[14px] text-ink-500">
          {campuses.length} {campuses.length === 1 ? "campus" : "campuses"} · {totalStudents.toLocaleString()} students · {totalStaff.toLocaleString()} staff
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {campuses.map((c) => {
          const active = c.id === activeCampusId;
          return (
            <div
              key={c.id}
              className="flex flex-col justify-between rounded-lg border border-hair bg-surface p-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[15px] font-semibold text-ink-900">{c.name}</div>
                  {active && (
                    <span className="rounded-full bg-[#0F6CBD]/10 px-2 py-0.5 text-[11px] font-medium text-[#0F6CBD]">
                      Current
                    </span>
                  )}
                  {c.status !== "active" && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {c.status}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">{c.slug}.campustwin.org</div>
                <div className="mt-3 flex gap-5 text-[13px] text-ink-700">
                  <span><span className="font-semibold text-ink-900">{c.students.toLocaleString()}</span> students</span>
                  <span><span className="font-semibold text-ink-900">{c.staff.toLocaleString()}</span> staff</span>
                </div>
              </div>
              <form action={switchCampus} className="mt-4">
                <input type="hidden" name="campusId" value={c.id} />
                <button
                  type="submit"
                  disabled={active}
                  className="w-full rounded-md border border-hair px-3 py-2 text-[13px] font-medium text-ink-900 hover:bg-panel disabled:cursor-default disabled:opacity-50"
                >
                  {active ? "Working in this campus" : "Open this campus"}
                </button>
              </form>
            </div>
          );
        })}
      </div>

      {campusStats.length > 0 && <div className="mt-6 flex items-center justify-between rounded-lg border border-hair bg-surface p-4 text-[13px]"><span>Counts for NAAC and AISHE, campus by campus</span>
        <CsvButton filename={`${university.name} campus statistics.csv`} headers={["Campus", "Students", "Female", "SC", "ST", "OBC", "EWS", "PwD", "Teaching staff", "Programmes", "Departments"]}
          rows={campusStats.map((c) => [c.campus, c.stats.students, female(c.stats.by_gender), c.stats.by_category?.sc ?? 0, c.stats.by_category?.st ?? 0, c.stats.by_category?.obc ?? 0, c.stats.by_category?.ews ?? 0, c.stats.pwd ?? 0, c.stats.staff, c.stats.programmes, c.stats.departments])} /></div>}
      <div className="mt-6 space-y-4"><UniversityChart chart={uniChart as unknown as UniChart | null} />
        <TransferRequests rows={reqRows.map((r) => ({ ...r, student: nameOf.get(r.id) ?? null }))} campuses={campuses.map((c) => ({ id: c.id, name: c.name }))} university={university.name} />
        <CommonExam campuses={campuses.map((c) => ({ id: c.id, name: c.name }))} /></div>
      <CentralTools campuses={campuses.map((c) => ({ id: c.id, name: c.name }))} exams={(exams ?? []) as unknown as ExamRow[]} transfers={(transfers ?? []) as unknown as TransferRow[]} />

      {campuses.length === 0 && (
        <p className="rounded-md border border-hair px-4 py-3 text-[14px] text-ink-700">
          No campuses yet for this university.
        </p>
      )}
    </div>
  );
}
