import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { InvigilationDesk, type Duty } from "@/components/exams/invigilation";

// An invigilator's duties: the room roster, present or absent, and malpractice reports.
export default async function InvigilationPage() {
  const denied = await guardTab("/dashboard/invigilation");
  if (denied) return denied;
  const session = await getSession();
  if (!session) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("exam_duty" as never).select("session_id, exam_date, starts_at, room:room_id(name), session:session_id(name)")
    .eq("staff_id", session.staffId ?? 0).gte("exam_date", new Date(Date.now() + 5.5 * 3600 * 1000 - 86400000).toISOString().slice(0, 10)).order("exam_date").order("starts_at").limit(100);
  return (
    <div className="space-y-4">
      <PageHeader title="Invigilation" description="Your exam duties. Open a duty to mark who is present and to report malpractice." />
      <InvigilationDesk duties={(data ?? []) as unknown as Duty[]} />
    </div>
  );
}
