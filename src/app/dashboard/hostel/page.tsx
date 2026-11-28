import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { getMyChildren } from "@/lib/data/analytics";
import { HostelDesk, type HostelView } from "@/components/operations/operations";
import { FamilyPasses, WardenPasses, RollCall, Wardens, type PassRow } from "@/components/hostel/passes";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const PASS_COLS = "id, student_id, kind, reason, out_at, back_by, status, decision_note, left_at, returned_at, student:student_id(full_name)";

// Hostel: rooms and beds (office); passes and the nightly roll (warden and office); passes for students and families.
export default async function HostelPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/hostel");
  if (denied) return denied;
  const [session, sp] = await Promise.all([getSession(), searchParams]);
  if (!session) return null;
  const supabase = await createClient();

  // students and families: passes
  if (session.role === "student" || session.role === "guardian") {
    const kids = session.role === "guardian" ? (await getMyChildren()).map((k) => ({ id: k.id, name: k.full_name })) : session.studentId ? [{ id: session.studentId, name: session.fullName }] : [];
    const { data } = await supabase.from("hostel_pass" as never).select(PASS_COLS).order("out_at", { ascending: false }).limit(50);
    return (<div className="space-y-4"><PageHeader title="Hostel" description="Ask the warden for an outing or a home visit. You are told when it is approved, and when the student leaves and returns." />
      <FamilyPasses kids={kids} passes={(data ?? []) as unknown as PassRow[]} /></div>);
  }

  const isOffice = session.isAdminScope;
  // the hostels this person runs (all of them for the office; their own for a warden)
  const { data: hs } = await supabase.rpc("my_hostels" as never);
  const allHostels = (hs ?? []) as unknown as { id: number; name: string; kind: string; warden: string | null; warden_staff_id: number | null }[];
  const myHostels = allHostels;
  if (!myHostels.length && !isOffice) return <div><PageHeader title="Hostel" /><EmptyState art="no-access" title="You are not a hostel warden" hint="The office names a warden for each hostel." /></div>;
  const view = !myHostels.length ? "rooms" : one(sp.view) ?? (isOffice ? "rooms" : "passes");
  const hostelId = Number(one(sp.hostel)) || myHostels[0]?.id || 0;
  const tabs = [...(isOffice ? [["rooms", "Rooms and beds"]] : []), ["passes", "Passes"], ["roll", "Roll call"], ...(isOffice ? [["wardens", "Wardens"]] : [])];
  const nav = (
    <div className="flex flex-wrap gap-1.5">{tabs.map(([k, l]) => (
      <Link key={k} href={`?view=${k}&hostel=${hostelId}`} className={`rounded-sm border px-2.5 py-1 text-[13px] ${view === k ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>{l}</Link>))}
      {(view === "roll" || view === "passes") && myHostels.length > 1 && <span className="ml-2 flex gap-1">{myHostels.map((h) => <Link key={h.id} href={`?view=${view}&hostel=${h.id}`} className={`rounded-sm px-2 py-1 text-[12px] ${h.id === hostelId ? "bg-[#EBF3FC] text-[#0F6CBD]" : "text-ink-700"}`}>{h.name}</Link>)}</span>}
    </div>);
  let body: React.ReactNode = null;
  if (view === "passes") {
    const { data } = await supabase.rpc("hostel_open_passes" as never, { p_hostel: hostelId } as never);
    body = <WardenPasses passes={((data ?? []) as unknown as (PassRow & { student_name: string })[]).map((x) => ({ ...x, student: { full_name: x.student_name } }))} />;
  } else if (view === "roll") {
    const asked = one(sp.day) ?? "";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today();
    const { data } = await supabase.rpc("hostel_roll_sheet" as never, { p_hostel: hostelId, p_day: day } as never);
    body = <RollCall key={`${hostelId}-${day}`} hostelId={hostelId} day={day} rows={(data ?? []) as unknown as { student_id: number; student_name: string; room: string; status: string | null; on_pass: boolean }[]} />;
  } else if (view === "wardens" && isOffice) {
    const { data: st } = await supabase.from("staff").select("id, full_name").order("full_name").limit(1000);
    body = <Wardens hostels={allHostels} staff={((st ?? []) as { id: number; full_name: string }[]).map((x) => ({ id: x.id, name: x.full_name }))} />;
  } else if (isOffice) {
    const [r, a] = await Promise.all([
      supabase.from("hostel_room" as never).select("id, hostel_id, name, beds").order("name").limit(2000),
      supabase.from("hostel_allocation" as never).select("id, room_id, bed_no, student:student_id(full_name, admission_no)").is("to_date", null).limit(5000),
    ]);
    const rooms = (r.data ?? []) as unknown as { id: number; hostel_id: number; name: string; beds: number }[];
    const allocs = (a.data ?? []) as unknown as { id: number; room_id: number; bed_no: number; student: { full_name: string; admission_no: string } | null }[];
    const hostels: HostelView[] = allHostels.map((x) => ({
      id: x.id, name: x.name, kind: x.kind, warden: x.warden,
      rooms: rooms.filter((rm) => rm.hostel_id === x.id).map((rm) => ({ ...rm, beds_taken: allocs.filter((al) => al.room_id === rm.id).map((al) => ({ id: al.id, bed: al.bed_no, name: al.student?.full_name ?? "", adm: al.student?.admission_no ?? "" })) })),
    }));
    body = <><p className="text-[13px] text-ink-700">{allocs.length} of {rooms.reduce((n, x) => n + x.beds, 0)} beds taken. A bed cannot be given twice; hostel fees are charged in Fees as a fee head.</p><HostelDesk hostels={hostels} canEdit={session.staffRole === "office"} /></>;
  }
  return (<div className="space-y-4"><PageHeader title="Hostel" />{nav}{body}</div>);
}
