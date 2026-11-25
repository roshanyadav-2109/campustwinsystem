import { notFound } from "next/navigation";
import { requireSetUp } from "@/lib/context";
import { fmtWhen } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, btnPrimary, btnGhost, btnDanger, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { rsvp, cancelEvent } from "../../actions";

export const metadata = { title: "Event" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, org, isStaff, memberId } = await requireSetUp();
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const id = Number(raw);
  const { data: e } = await db.from("event").select("*").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (!e) notFound();
  const [mine, going, guests] = await Promise.all([
    memberId ? db.from("rsvp").select("status").eq("event_id", id).eq("member_id", memberId).maybeSingle() : Promise.resolve({ data: null }),
    isStaff ? db.from("rsvp").select("member_id", { count: "exact", head: true }).eq("event_id", id).eq("status", "going") : Promise.resolve({ count: null }),
    isStaff ? db.from("rsvp").select("status, member:member!rsvp_org_id_member_id_fkey(full_name, batch_year, email)").eq("event_id", id).eq("status", "going").limit(1000) : Promise.resolve({ data: null }),
  ]);
  const past = new Date(e.starts_at) < new Date();
  const open = e.status === "published" && !past;

  return (
    <div>
      <PageHeader title={e.title} sub={<>{fmtWhen(e.starts_at)}{e.venue ? `, ${e.venue}` : ""}</>}>
        {isStaff && open && <ActionForm action={cancelEvent}><input type="hidden" name="id" value={e.id} /><Submit className={btnDanger} pending="Cancelling">Cancel event</Submit></ActionForm>}
      </PageHeader>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section>
          {e.status === "cancelled" && <p className="mb-3"><Status tone="bad">This event has been cancelled</Status></p>}
          {e.description ? <p className="whitespace-pre-line text-[14.5px] leading-6 text-cx-text-2">{e.description}</p> : <p className="text-[14px] text-cx-muted">No further details.</p>}
          {e.online_url && <p className="mt-3 text-[14px]"><a href={e.online_url} target="_blank" rel="noreferrer" className="text-cx-link hover:underline">Join online</a></p>}
          {e.capacity && <p className="mt-3 text-[13px] text-cx-muted">{e.capacity} seats</p>}
        </Section>
        <div className="space-y-4">
          {memberId && open && (
            <Section title="Are you coming?">
              <p className="mb-3 text-[14px] text-cx-text-2">{mine.data?.status === "going" ? "You said you are going." : mine.data?.status === "not_going" ? "You said you are not going." : "Let the alumni office know."}</p>
              <div className="flex gap-2">
                <ActionForm action={rsvp}><input type="hidden" name="event_id" value={e.id} /><input type="hidden" name="status" value="going" /><Submit className={btnPrimary} pending="Saving">Going</Submit></ActionForm>
                <ActionForm action={rsvp}><input type="hidden" name="event_id" value={e.id} /><input type="hidden" name="status" value="not_going" /><Submit className={btnGhost} pending="Saving">Not going</Submit></ActionForm>
              </div>
            </Section>
          )}
          {isStaff && (
            <Section title="Coming" desc={`${going.count ?? 0}${e.capacity ? ` of ${e.capacity}` : ""} going`} flush>
              {guests.data?.length ? (
                <Table head={[{ label: "Name" }, { label: "Batch" }]}>
                  {guests.data.map((g, i) => {
                    const m = g.member as unknown as { full_name: string; batch_year: number | null; email: string | null };
                    return <tr key={i}><td className={td}><span className="text-cx-text">{m?.full_name}</span>{m?.email && <div className="text-[12px] text-cx-muted">{m.email}</div>}</td><td className={td}>{m?.batch_year ?? ""}</td></tr>;
                  })}
                </Table>
              ) : <Empty>Nobody yet.</Empty>}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
