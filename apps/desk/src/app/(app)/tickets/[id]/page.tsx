import { notFound } from "next/navigation";
import { requireSetUp } from "@/lib/context";
import { agentMap } from "@/lib/agents";
import { fmtWhen, dueText, STATUS_LABEL, STATUS_TONE, KIND_LABEL, DONE } from "@/lib/format";
import { PageHeader, Section, inputCls, labelCls, btnPrimary, btnGhost, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { replyTicket, updateTicket } from "../../actions";

export const metadata = { title: "Request" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, org } = await requireSetUp();
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const id = Number(raw);
  const { data: t, error } = await db.from("ticket").select("*").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load this request: " + error.message);
  if (!t) notFound();
  const [{ data: msgs }, { data: cats }, agents] = await Promise.all([
    db.from("message").select("id, author_kind, author_name, body, internal, created_at").eq("ticket_id", id).order("created_at"),
    db.from("category").select("id, name, active").eq("org_id", org.id).order("name"),
    agentMap(db, org.id),
  ]);
  const done = DONE.includes(t.status);
  const reply = dueText(t.respond_by, done || !!t.first_response_at);
  const resolve = dueText(t.resolve_by, done);

  return (
    <div>
      <PageHeader title={t.subject} sub={<span className="flex flex-wrap items-center gap-x-3"><span>#{t.number}</span><span>{KIND_LABEL[t.kind]}</span><Status tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Status></span>} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <div className="rounded-[10px] border border-cx-line bg-cx-card p-4">
            <p className="text-[12.5px] text-cx-muted">{t.requester_name}, {fmtWhen(t.created_at)}{t.source === "agent" ? ", logged by the help desk" : ""}</p>
            <p className="mt-1 whitespace-pre-line text-[14px] leading-6 text-cx-text">{t.description}</p>
          </div>
          {(msgs ?? []).map((m) => (
            <div key={m.id} className={`rounded-[10px] border p-4 ${m.internal ? "border-dashed border-cx-warn/60 bg-cx-warn/[0.05]" : m.author_kind === "agent" ? "border-cx-line-strong bg-cx-raised" : "border-cx-line bg-cx-card"}`}>
              <p className="text-[12.5px] text-cx-muted">{m.internal ? "Internal note by " : ""}{m.author_name}{m.author_kind === "requester" ? " (requester)" : ""}, {fmtWhen(m.created_at)}</p>
              <p className="mt-1 whitespace-pre-line text-[14px] leading-6 text-cx-text">{m.body}</p>
            </div>
          ))}
          {t.status !== "closed" ? (
            <Section title="Reply">
              <ActionForm action={replyTicket} reset className="space-y-3">
                <input type="hidden" name="id" value={t.id} />
                <label htmlFor="body" className="sr-only">Message</label>
                <textarea id="body" name="body" rows={5} maxLength={8000} required className={inputCls} />
                <div className="flex flex-wrap items-center gap-3">
                  <fieldset className="flex gap-3 text-[13.5px] text-cx-text-2">
                    <legend className="sr-only">Who sees it</legend>
                    <label className="flex items-center gap-1.5"><input type="radio" name="mode" value="reply" defaultChecked className="accent-cx-text" /> Reply to {t.requester_name.split(" ")[0]}</label>
                    <label className="flex items-center gap-1.5"><input type="radio" name="mode" value="note" className="accent-cx-text" /> Internal note</label>
                  </fieldset>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="then" value="resolved" className={btnPrimary}>Send and resolve</button>
                  <button type="submit" name="then" value="waiting" className={btnGhost}>Send and wait for reply</button>
                  <Submit className={btnGhost} pending="Sending">Send</Submit>
                </div>
                <p className="text-[12px] text-cx-faint">The requester sees replies on their private tracking link{t.requester_email ? ` (${t.requester_email})` : ""}. Internal notes are only for the help desk.</p>
              </ActionForm>
            </Section>
          ) : <p className="text-[13.5px] text-cx-muted">This request is closed.</p>}
        </div>

        <div className="space-y-4">
          <Section title="Details">
            <ActionForm action={updateTicket} className="space-y-3">
              <input type="hidden" name="id" value={t.id} />
              <div>
                <label htmlFor="status" className={labelCls}>Status</label>
                <select id="status" name="status" defaultValue={t.status} className={inputCls}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="priority" className={labelCls}>Priority</label>
                  <select id="priority" name="priority" defaultValue={t.priority} className={inputCls}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
                </div>
                <div>
                  <label htmlFor="kind" className={labelCls}>Type</label>
                  <select id="kind" name="kind" defaultValue={t.kind} className={inputCls}><option value="request">Request</option><option value="complaint">Complaint</option><option value="grievance">Grievance</option></select>
                </div>
              </div>
              <div>
                <label htmlFor="assignee_id" className={labelCls}>Assigned to</label>
                <select id="assignee_id" name="assignee_id" defaultValue={t.assignee_id ?? ""} className={inputCls}>
                  <option value="">Nobody</option>{agents.list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="category_id" className={labelCls}>About</label>
                <select id="category_id" name="category_id" defaultValue={t.category_id ?? ""} className={inputCls}>
                  <option value="">Not set</option>{(cats ?? []).filter((c) => c.active || c.id === t.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <Submit className={btnGhost}>Save</Submit>
            </ActionForm>
          </Section>
          <Section title="Deadlines">
            <dl className="space-y-2 text-[13.5px]">
              <div><dt className="text-cx-muted">First reply</dt><dd className={reply?.late ? "font-medium text-cx-bad" : "text-cx-text"}>{t.first_response_at ? `Replied ${fmtWhen(t.first_response_at)}` : reply ? `By ${fmtWhen(t.respond_by)}, ${reply.text}` : ""}</dd></div>
              <div><dt className="text-cx-muted">Resolution</dt><dd className={resolve?.late ? "font-medium text-cx-bad" : "text-cx-text"}>{t.resolved_at ? `Resolved ${fmtWhen(t.resolved_at)}` : resolve ? `By ${fmtWhen(t.resolve_by)}, ${resolve.text}` : ""}</dd></div>
            </dl>
          </Section>
          <Section title="Requester">
            <p className="text-[14px] text-cx-text">{t.requester_name}</p>
            {t.requester_email && <p className="text-[13.5px] text-cx-text-2">{t.requester_email}</p>}
            {t.requester_phone && <p className="text-[13.5px] text-cx-text-2">{t.requester_phone}</p>}
            <p className="mt-2 break-all text-[12px] text-cx-faint">Their tracking link: desk.campustwin.org/t/{t.public_token}</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
