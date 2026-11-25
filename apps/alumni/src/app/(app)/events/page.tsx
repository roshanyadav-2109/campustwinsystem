import Link from "next/link";
import { requireSetUp } from "@/lib/context";
import { fmtWhen, todayIST } from "@/lib/format";
import { PageHeader, Section, Empty, inputCls, labelCls, btnPrimary, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { saveEvent } from "../actions";

export const metadata = { title: "Events" };

export default async function Events() {
  const { db, org, isStaff } = await requireSetUp();
  const now = new Date().toISOString();
  const [upcoming, past] = await Promise.all([
    db.from("event").select("id, title, starts_at, venue, status").eq("org_id", org.id).gte("starts_at", now).order("starts_at").limit(50),
    db.from("event").select("id, title, starts_at, venue, status").eq("org_id", org.id).lt("starts_at", now).order("starts_at", { ascending: false }).limit(10),
  ]);
  const list = (rows: typeof upcoming.data) => (
    <ul className="divide-y divide-cx-line">
      {(rows ?? []).map((e) => (
        <li key={e.id} className="px-5 py-3">
          <Link href={`/events/${e.id}`} className="text-[14.5px] font-medium text-cx-text hover:underline">{e.title}</Link>
          {e.status === "cancelled" && <span className="ml-2 text-[12px] text-cx-bad">cancelled</span>}
          <p className="text-[13px] text-cx-muted">{fmtWhen(e.starts_at)}{e.venue ? `, ${e.venue}` : ""}</p>
        </li>
      ))}
    </ul>
  );
  return (
    <div>
      <PageHeader title="Events" sub="Reunions, talks and meet-ups" />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Section title="Coming up" flush>{upcoming.data?.length ? list(upcoming.data) : <Empty>No events planned yet.</Empty>}</Section>
          {!!past.data?.length && <Section title="Past" flush>{list(past.data)}</Section>}
        </div>
        {isStaff && (
          <Section title="New event">
            <ActionForm action={saveEvent} className="space-y-3">
              <div><label htmlFor="title" className={labelCls}>Title</label><input id="title" name="title" required maxLength={160} placeholder="Batch of 2016 reunion" className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="day" className={labelCls}>Date</label><input id="day" name="day" type="date" required min={todayIST()} className={inputCls} /></div>
                <div><label htmlFor="time" className={labelCls}>Time</label><input id="time" name="time" type="time" defaultValue="18:00" className={inputCls} /></div>
              </div>
              <div><label htmlFor="venue" className={labelCls}>Venue</label><input id="venue" name="venue" maxLength={200} className={inputCls} /></div>
              <div><label htmlFor="online_url" className={labelCls}>Online link (optional)</label><input id="online_url" name="online_url" placeholder="https://" className={inputCls} /></div>
              <div><label htmlFor="capacity" className={labelCls}>Seats (optional)</label><input id="capacity" name="capacity" type="number" min={1} className={inputCls} /></div>
              <div><label htmlFor="description" className={labelCls}>Details</label><textarea id="description" name="description" rows={3} maxLength={4000} className={inputCls} /></div>
              <Submit className={btnPrimary} pending="Publishing">Publish event</Submit>
            </ActionForm>
            <p className="mt-3 text-[12.5px] text-cx-muted">Alumni see it straight away and can say whether they are coming. <Link href="/news" className={linkCls}>Post news</Link> to tell them.</p>
          </Section>
        )}
      </div>
    </div>
  );
}
