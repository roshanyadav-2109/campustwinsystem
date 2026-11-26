import Link from "next/link";
import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { MarkAllRead } from "@/components/notifications/mark-all-read";

type Row = { id: number; title: string; body: string; link: string | null; created_at: string; read_at: string | null };

// The person's own notifications at this institution, newest first.
export default async function NotificationsPage() {
  const denied = await guardTab("/dashboard/notifications");
  if (denied) return denied;
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_notifications" as never, { p_limit: 100 } as never);
  const rows = (data ?? []) as unknown as Row[];
  const unread = rows.filter((r) => !r.read_at).map((r) => r.id);

  return (
    <div className="space-y-4">
      <PageHeader title="Notifications" description="Messages from your institution." />
      {rows.length === 0 ? (
        <EmptyState art="all-done" title="No notifications yet" hint="When the school sends you something, it appears here." />
      ) : (
        <>
          {unread.length > 0 && <MarkAllRead ids={unread} />}
          <Card>
            <CardBody className="p-0">
              <ul>
                {rows.map((r) => (
                  <li key={r.id} className="border-b border-hair px-4 py-3 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.read_at ? "bg-transparent" : "bg-[#0F6CBD]"}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-[14px] ${r.read_at ? "text-ink-700" : "font-semibold text-ink-900"}`}>{r.title}</p>
                        <p className="mt-0.5 whitespace-pre-line text-[13px] text-ink-700">{r.body}</p>
                        <p className="mt-1 text-[12px] text-ink-500">
                          {new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          {r.link && r.link.startsWith("/") && <> · <Link className="text-[#0F6CBD] hover:underline" href={r.link}>Open</Link></>}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
