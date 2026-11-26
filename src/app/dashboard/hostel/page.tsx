import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { HostelDesk, type HostelView } from "@/components/operations/operations";

// Hostel: hostels, rooms and beds, and who is in each bed.
export default async function HostelPage() {
  const denied = await guardTab("/dashboard/hostel");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const [h, r, a] = await Promise.all([
    supabase.from("hostel" as never).select("id, name, kind, warden").order("name"),
    supabase.from("hostel_room" as never).select("id, hostel_id, name, beds").order("name").limit(2000),
    supabase.from("hostel_allocation" as never).select("id, room_id, bed_no, student:student_id(full_name, admission_no)").is("to_date", null).limit(5000),
  ]);
  const rooms = (r.data ?? []) as unknown as { id: number; hostel_id: number; name: string; beds: number }[];
  const allocs = (a.data ?? []) as unknown as { id: number; room_id: number; bed_no: number; student: { full_name: string; admission_no: string } | null }[];
  const hostels: HostelView[] = ((h.data ?? []) as unknown as { id: number; name: string; kind: string; warden: string | null }[]).map((x) => ({
    ...x, rooms: rooms.filter((rm) => rm.hostel_id === x.id).map((rm) => ({ ...rm, beds_taken: allocs.filter((al) => al.room_id === rm.id).map((al) => ({ id: al.id, bed: al.bed_no, name: al.student?.full_name ?? "", adm: al.student?.admission_no ?? "" })) })),
  }));
  const total = rooms.reduce((n, x) => n + x.beds, 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Hostel" description={`${allocs.length} of ${total} beds taken. A bed cannot be given twice, and a student holds one bed at a time. Hostel fees are charged in Fees as a fee head.`} />
      <HostelDesk hostels={hostels} canEdit={session?.staffRole === "office"} />
    </div>
  );
}
