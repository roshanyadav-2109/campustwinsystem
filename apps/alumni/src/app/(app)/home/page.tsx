import Link from "next/link";
import { getCtx } from "@/lib/context";
import { todayIST, fyOf, inrShort, fmtWhen, fmtDate } from "@/lib/format";
import { PageHeader, Section, Kpi, kpiStrip, Empty, btnPrimary, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { setupAlumni } from "../actions";

export const metadata = { title: "Home" };

export default async function Home() {
  const { db, org, setUp, isAdmin, isStaff, memberId } = await getCtx();
  if (!setUp) {
    return (
      <div>
        <PageHeader title="Welcome to Eternity Alumni" sub={org.name} />
        <Section>
          <p className="text-[14px] leading-6 text-cx-text-2">
            {isAdmin ? "Start your alumni network. You get a join link to share with alumni, a directory, events, a jobs board, news and giving with 80G receipts."
              : "The alumni network for this institution has not been started yet."}
          </p>
          {isAdmin && <ActionForm action={setupAlumni} className="mt-4"><Submit className={btnPrimary} pending="Starting">Start the alumni network</Submit></ActionForm>}
        </Section>
      </div>
    );
  }

  const today = todayIST();
  const fy = fyOf(today);
  const nowIso = new Date().toISOString();
  const [events, news, jobs, settings, me, staffCounts] = await Promise.all([
    db.from("event").select("id, title, starts_at, venue").eq("org_id", org.id).eq("status", "published").gte("starts_at", nowIso).order("starts_at").limit(4),
    db.from("post").select("id, title, body, created_at").eq("org_id", org.id).order("created_at", { ascending: false }).limit(3),
    db.from("job").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "open"),
    db.from("settings").select("display_name").eq("org_id", org.id).single(),
    memberId ? db.from("member").select("full_name, batch_year").eq("id", memberId).single() : Promise.resolve({ data: null }),
    isStaff ? Promise.all([
      db.from("member").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "verified"),
      db.from("member").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "pending"),
      db.from("donation").select("amount").eq("org_id", org.id).eq("status", "recorded").gte("donated_on", fy.start).lte("donated_on", fy.end).limit(10000),
      db.from("member").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "verified").not("user_id", "is", null),
    ]) : Promise.resolve(null),
  ]);
  const first = me.data?.full_name?.split(/\s+/).find((w) => !/^(dr|mr|mrs|ms|miss|prof|shri|smt|sri)\.?$/i.test(w));

  return (
    <div>
      <PageHeader title={first ? `Welcome back, ${first}` : settings.data?.display_name ?? org.name} sub={me.data?.batch_year ? `Batch of ${me.data.batch_year}` : first ? undefined : "Alumni network"} />

      {staffCounts && (
        <div className={kpiStrip}>
          <Kpi label="Alumni in the network" value={staffCounts[0].count ?? 0} sub={`${staffCounts[3].count ?? 0} have signed in`} />
          <Kpi label="Requests to review" value={staffCounts[1].count ?? 0} />
          <Kpi label={`Raised in ${fy.label}`} value={inrShort((staffCounts[2].data ?? []).reduce((s, d) => s + Number(d.amount), 0))} />
          <Kpi label="Open jobs" value={jobs.count ?? 0} />
        </div>
      )}
      {staffCounts && (staffCounts[1].count ?? 0) > 0 && (
        <p className="mb-4 text-[14px]"><Link href="/office/alumni?status=pending" className={linkCls}>Review {staffCounts[1].count} request{staffCounts[1].count === 1 ? "" : "s"} to join</Link></p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Coming up" right={<Link href="/events" className={linkCls}>All events</Link>} flush>
          {events.data?.length ? (
            <ul className="divide-y divide-cx-line">
              {events.data.map((e) => (
                <li key={e.id} className="px-5 py-3">
                  <Link href={`/events/${e.id}`} className="text-[14.5px] font-medium text-cx-text hover:underline">{e.title}</Link>
                  <p className="text-[13px] text-cx-muted">{fmtWhen(e.starts_at)}{e.venue ? `, ${e.venue}` : ""}</p>
                </li>
              ))}
            </ul>
          ) : <Empty>No events planned yet.</Empty>}
        </Section>
        <Section title="News" right={<Link href="/news" className={linkCls}>All news</Link>} flush>
          {news.data?.length ? (
            <ul className="divide-y divide-cx-line">
              {news.data.map((n) => (
                <li key={n.id} className="px-5 py-3">
                  <p className="text-[14.5px] font-medium text-cx-text">{n.title}</p>
                  <p className="line-clamp-2 text-[13.5px] text-cx-text-2">{n.body}</p>
                  <p className="mt-0.5 text-[12px] text-cx-faint">{fmtDate(n.created_at)}</p>
                </li>
              ))}
            </ul>
          ) : <Empty>No news yet.</Empty>}
        </Section>
      </div>
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px]">
        <Link href="/directory" className={linkCls}>Find classmates</Link>
        <Link href="/jobs" className={linkCls}>{jobs.count ?? 0} open job{jobs.count === 1 ? "" : "s"}</Link>
        <Link href="/giving" className={linkCls}>Give back</Link>
      </p>
    </div>
  );
}
