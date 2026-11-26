import Link from "next/link";
import { guardTab } from "@/lib/access";
import { getCurrentYear, getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { SelectionDesk, type Applicant, type SeatRow, type SlotRow, type MeritRow } from "@/components/admissions/selection";

type SP = Promise<Record<string, string | string[] | undefined>>;

// Admissions, Selection: seats per class, applicants' scores, application
// fee, test / interview slots, documents, and the merit list.
export default async function SelectionPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/admissions");
  if (denied) return denied;
  const session = await getSession();
  if (!session?.isAdminScope) return <EmptyState art="no-access" title="Admissions are handled by the school office" />;
  const year = await getCurrentYear();
  if (!year) return <EmptyState art="nothing-yet" title="No school year is set up yet" />;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: seatData } = await supabase.rpc("admission_seats" as never, { p_year: year.id } as never);
  const seats = (seatData ?? []) as unknown as SeatRow[];
  const classId = Number(Array.isArray(sp.class) ? sp.class[0] : sp.class) || seats[0]?.class_id || 0;
  const [apps, slots, merit] = await Promise.all([
    supabase.from("admission_enquiry").select("id, child_name, guardian_name, phone, status, score, score_note, app_fee_amount, app_fee_paid_on, app_fee_ref, created_at" as "id")
      .eq("academic_year_id", year.id).eq("class_id", classId).not("status", "in", "(admitted,not_interested)").order("created_at").limit(1000),
    supabase.from("admission_slot" as never).select("id, kind, class_id, starts_at, venue, capacity").eq("academic_year_id", year.id).order("starts_at"),
    supabase.rpc("admission_merit" as never, { p_year: year.id, p_class: classId } as never),
  ]);
  const appIds = ((apps.data ?? []) as unknown as { id: number }[]).map((a) => a.id);
  const slotIds = ((slots.data ?? []) as unknown as { id: number }[]).map((x) => x.id);
  const [docs, bookings, usage] = await Promise.all([
    supabase.from("admission_document" as never).select("id, enquiry_id, kind").in("enquiry_id", appIds.length ? appIds.slice(0, 300) : [0]).limit(1000),
    supabase.from("admission_booking" as never).select("enquiry_id, slot_id, kind").in("enquiry_id", appIds.length ? appIds.slice(0, 300) : [0]).limit(1000),
    supabase.rpc("admission_slot_usage" as never, { p_year: year.id } as never),
  ]);
  const usedBy = new Map(((usage.data ?? []) as unknown as { slot_id: number; used: number }[]).map((u) => [u.slot_id, u.used]));
  void slotIds;
  const docRows = (docs.data ?? []) as unknown as { id: number; enquiry_id: number; kind: string }[];
  const bookRows = (bookings.data ?? []) as unknown as { enquiry_id: number; slot_id: number; kind: string }[];
  const applicants: Applicant[] = ((apps.data ?? []) as unknown as Omit<Applicant, "docs" | "bookings">[]).map((a) => ({
    ...a, docs: docRows.filter((d) => d.enquiry_id === a.id), bookings: bookRows.filter((x) => x.enquiry_id === a.id),
  }));
  const slotRows = ((slots.data ?? []) as unknown as SlotRow[]).filter((s) => s.class_id == null || s.class_id === classId)
    .map((s) => ({ ...s, used: usedBy.get(s.id) ?? 0 }));
  return (
    <div className="space-y-4">
      <PageHeader title="Admissions: selection" description={`Seats, entrance test and interview slots, scores, the application fee, documents and the merit list for ${year.name}.`} />
      <Link href="/dashboard/admissions" className="text-[13px] font-medium text-[#0F6CBD] hover:underline">Back to enquiries</Link>
      <SelectionDesk key={classId} canEdit={session.staffRole === "office"} classId={classId} seats={seats} applicants={applicants} slots={slotRows} merit={(merit.data ?? []) as unknown as MeritRow[]} />
    </div>
  );
}
