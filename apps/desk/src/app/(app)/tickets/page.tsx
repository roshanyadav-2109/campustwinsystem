import Link from "next/link";
import { requireSetUp } from "@/lib/context";
import { agentMap } from "@/lib/agents";
import { PageHeader, Section, inputBase, btnGhost, btnPrimary } from "@/components/ui";
import { TicketTable, type Row } from "@/components/ticket-table";

export const metadata = { title: "Requests" };
const PAGE = 50;
const COLS = "id, number, subject, kind, priority, status, requester_name, assignee_id, respond_by, resolve_by, first_response_at, created_at";

export default async function Tickets({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; who?: string; kind?: string; late?: string; page?: string }> }) {
  const { db, org, userId } = await requireSetUp();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().replace(/[%_,()\\"*:]/g, " ").trim().slice(0, 60);
  const status = ["open", "in_progress", "waiting", "resolved", "closed", "all"].includes(sp.status ?? "") ? sp.status! : "active";
  const who = ["me", "nobody"].includes(sp.who ?? "") ? sp.who! : "anyone";
  const kind = ["request", "complaint", "grievance"].includes(sp.kind ?? "") ? sp.kind! : "all";
  const late = sp.late === "1";
  const page = Math.max(1, Number(sp.page) || 1);

  let query = db.from("ticket").select(COLS, { count: "exact" }).eq("org_id", org.id);
  if (status === "active") query = query.not("status", "in", "(resolved,closed)");
  else if (status !== "all") query = query.eq("status", status);
  if (who === "me") query = query.eq("assignee_id", userId);
  if (who === "nobody") query = query.is("assignee_id", null);
  if (kind !== "all") query = query.eq("kind", kind);
  if (late) query = query.lt("resolve_by", new Date().toISOString()).not("status", "in", "(resolved,closed)");
  if (q) {
    const n = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
    query = n ? query.eq("number", n) : query.or(`subject.ilike.%${q}%,requester_name.ilike.%${q}%,requester_email.ilike.%${q}%`);
  }
  const [{ data: rows, count }, agents] = await Promise.all([
    query.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    agentMap(db, org.id),
  ]);
  const total = count ?? 0;
  const link = (p: number) => `/tickets?${new URLSearchParams({ ...(q && { q }), ...(status !== "active" && { status }), ...(who !== "anyone" && { who }), ...(kind !== "all" && { kind }), ...(late && { late: "1" }), page: String(p) })}`;

  return (
    <div>
      <PageHeader title="Requests" sub={`${total} ${status === "active" ? "open" : ""} request${total === 1 ? "" : "s"}`.replace("  ", " ")}>
        <Link href="/tickets/new" className={btnPrimary}>Log a request</Link>
      </PageHeader>
      <form className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="filter-q" className="sr-only">Search</label>
        <input id="filter-q" name="q" defaultValue={q} placeholder="Subject, name, email or #number" className={`${inputBase} w-64`} />
        <label htmlFor="filter-status" className="sr-only">Status</label>
        <select id="filter-status" name="status" defaultValue={status} className={`${inputBase} w-auto`}>
          <option value="active">Not yet resolved</option><option value="open">Open</option><option value="in_progress">In progress</option>
          <option value="waiting">Waiting for requester</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">Everything</option>
        </select>
        <label htmlFor="filter-who" className="sr-only">Assigned to</label>
        <select id="filter-who" name="who" defaultValue={who} className={`${inputBase} w-auto`}>
          <option value="anyone">Anyone</option><option value="me">Assigned to me</option><option value="nobody">Nobody assigned</option>
        </select>
        <label htmlFor="filter-kind" className="sr-only">Type</label>
        <select id="filter-kind" name="kind" defaultValue={kind} className={`${inputBase} w-auto`}>
          <option value="all">All types</option><option value="request">Requests</option><option value="complaint">Complaints</option><option value="grievance">Grievances</option>
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-cx-text-2"><input type="checkbox" name="late" value="1" defaultChecked={late} className="h-4 w-4 accent-cx-text" /> Past deadline</label>
        <button className={btnGhost}>Show</button>
      </form>
      <Section flush>
        <TicketTable rows={(rows ?? []) as Row[]} agents={agents.names} empty={q || who !== "anyone" || kind !== "all" || late ? "Nothing matches." : "No requests yet. Share your help page so people can reach you."} />
        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-cx-line px-5 py-2.5 text-[13px] text-cx-muted">
            <span>{(page - 1) * PAGE + 1} to {Math.min(page * PAGE, total)} of {total}</span>
            <span className="flex gap-2">
              {page > 1 && <Link href={link(page - 1)} className={btnGhost}>Previous</Link>}
              {page * PAGE < total && <Link href={link(page + 1)} className={btnGhost}>Next</Link>}
            </span>
          </div>
        )}
      </Section>
    </div>
  );
}
