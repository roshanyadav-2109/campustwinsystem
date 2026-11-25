import Link from "next/link";
import { getCtx } from "@/lib/context";
import { agentMap } from "@/lib/agents";
import { PageHeader, Section, Kpi, kpiStrip, btnPrimary, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { TicketTable, type Row } from "@/components/ticket-table";
import { setupDesk } from "../actions";

export const metadata = { title: "Home" };
const COLS = "id, number, subject, kind, priority, status, requester_name, assignee_id, respond_by, resolve_by, first_response_at, created_at";

export default async function Home() {
  const { db, org, setUp, isAdmin, userId } = await getCtx();
  if (!setUp) {
    return (
      <div>
        <PageHeader title="Welcome to Eternity Desk" sub={org.name} />
        <Section>
          <p className="text-[14px] leading-6 text-cx-text-2">{isAdmin ? "Start your help desk. You get a public help page to share with parents, students, staff or customers, a queue with deadlines, and a help centre." : "The help desk for this organisation has not been started yet."}</p>
          {isAdmin && <ActionForm action={setupDesk} className="mt-4"><Submit className={btnPrimary} pending="Starting">Start the help desk</Submit></ActionForm>}
        </Section>
      </div>
    );
  }
  const now = new Date().toISOString();
  const [mine, open, unassigned, lateReply, lateResolve, settings, agents] = await Promise.all([
    db.from("ticket").select(COLS).eq("org_id", org.id).eq("assignee_id", userId).not("status", "in", "(resolved,closed)").order("resolve_by").limit(20),
    db.from("ticket").select("id", { count: "exact", head: true }).eq("org_id", org.id).not("status", "in", "(resolved,closed)"),
    db.from("ticket").select(COLS, { count: "exact" }).eq("org_id", org.id).is("assignee_id", null).not("status", "in", "(resolved,closed)").order("created_at").limit(10),
    db.from("ticket").select("id", { count: "exact", head: true }).eq("org_id", org.id).is("first_response_at", null).lt("respond_by", now).not("status", "in", "(resolved,closed)"),
    db.from("ticket").select("id", { count: "exact", head: true }).eq("org_id", org.id).lt("resolve_by", now).not("status", "in", "(resolved,closed)"),
    db.from("settings").select("public_code").eq("org_id", org.id).single(),
    agentMap(db, org.id),
  ]);

  return (
    <div>
      <PageHeader title="Home" sub="Your queue">
        <Link href="/tickets/new" className={btnPrimary}>Log a request</Link>
      </PageHeader>
      <div className={kpiStrip}>
        <Kpi label="Open requests" value={open.count ?? 0} />
        <Kpi label="Nobody assigned" value={unassigned.count ?? 0} />
        <Kpi label="Waiting too long for a reply" value={lateReply.count ?? 0} />
        <Kpi label="Past the resolution deadline" value={lateResolve.count ?? 0} />
      </div>
      <div className="space-y-4">
        <Section title="Assigned to you" flush>
          <TicketTable rows={(mine.data ?? []) as Row[]} agents={agents.names} empty="Nothing assigned to you." />
        </Section>
        <Section title="Nobody assigned yet" desc="Oldest first" right={<Link href="/tickets?who=nobody" className={linkCls}>See all</Link>} flush>
          <TicketTable rows={(unassigned.data ?? []) as Row[]} agents={agents.names} empty="Every open request has someone on it." />
        </Section>
        {settings.data && (
          <p className="text-[13px] text-cx-muted">Public help page: <a href={`/help/${settings.data.public_code}`} className="font-mono text-cx-link hover:underline">desk.campustwin.org/help/{settings.data.public_code}</a></p>
        )}
      </div>
    </div>
  );
}
