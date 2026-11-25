import Link from "next/link";
import { Table, td, linkCls, Status, Empty } from "@/components/ui";
import { fmtWhen, dueText, STATUS_LABEL, STATUS_TONE, PRIORITY_LABEL, KIND_LABEL, DONE } from "@/lib/format";

export type Row = {
  id: number; number: number; subject: string; kind: string; priority: string; status: string;
  requester_name: string; assignee_id: string | null; respond_by: string | null; resolve_by: string | null;
  first_response_at: string | null; created_at: string;
};

// The queue as a table: what it is, who raised it, where it stands, and the
// deadline that matters next (first response, then resolution).
export function TicketTable({ rows, agents, empty }: { rows: Row[]; agents: Map<string, string>; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <Table head={[{ label: "Request" }, { label: "From" }, { label: "Status" }, { label: "Deadline" }, { label: "With" }]}>
      {rows.map((t) => {
        const done = DONE.includes(t.status);
        const next = !t.first_response_at ? dueText(t.respond_by, done) : dueText(t.resolve_by, done);
        return (
          <tr key={t.id}>
            <td className={td}>
              <Link href={`/tickets/${t.id}`} className={linkCls}>{t.subject}</Link>
              <div className="text-[12px] text-cx-muted">#{t.number}, {KIND_LABEL[t.kind]}, {PRIORITY_LABEL[t.priority].toLowerCase()} priority</div>
            </td>
            <td className={td}>{t.requester_name}<div className="text-[12px] text-cx-muted">{fmtWhen(t.created_at)}</div></td>
            <td className={td}><Status tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Status></td>
            <td className={td}>{next ? <span className={next.late ? "font-medium text-cx-bad" : "text-cx-text-2"}>{!t.first_response_at ? "Reply " : "Resolve "}{next.text}</span> : ""}</td>
            <td className={td}>{t.assignee_id ? agents.get(t.assignee_id) ?? "Agent" : <span className="text-cx-muted">Nobody</span>}</td>
          </tr>
        );
      })}
    </Table>
  );
}
