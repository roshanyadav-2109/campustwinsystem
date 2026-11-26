import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { MessageChannels, type ChannelState } from "@/components/settings/message-channels";
import type { Channel, Provider } from "./actions";

type SettingRow = { channel: Channel; provider: Provider; config: ChannelState["config"]; secret_id: string | null };
type DeliveryRow = { id: number; channel: string; provider: string; to_address: string | null; subject: string | null; status: string; attempts: number; last_error: string | null; created_at: string };

const STATUS: Record<string, string> = { queued: "Waiting", sending: "Sending", sent: "Sent", failed: "Failed", skipped: "Not sent" };

function mask(to: string | null) {
  if (!to) return "—";
  if (to.includes("@")) { const [u, d] = to.split("@"); return `${u.slice(0, 2)}…@${d}`; }
  return to.length > 4 ? `…${to.slice(-4)}` : to;
}

// Settings → Messages and alerts (office edits; principal sees what was sent).
export default async function MessagesSettingsPage() {
  const denied = await guardTab("/dashboard/settings/messages");
  if (denied) return denied;
  const session = await getSession();
  const supabase = await createClient();
  const [setRes, delRes] = await Promise.all([
    supabase.from("notification_setting" as never).select("channel, provider, config, secret_id"),
    supabase.from("notification_delivery" as never).select("id, channel, provider, to_address, subject, status, attempts, last_error, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const rows = (setRes.data ?? []) as unknown as SettingRow[];
  const channels: ChannelState[] = (["email", "sms", "whatsapp"] as Channel[]).map((c) => {
    const r = rows.find((x) => x.channel === c);
    return { channel: c, provider: r?.provider ?? "off", hasKeys: !!r?.secret_id, config: r?.config ?? {} };
  });
  const deliveries = (delRes.data ?? []) as unknown as DeliveryRow[];
  const canEdit = session?.staffRole === "office";

  return (
    <div className="space-y-5">
      <PageHeader title="Messages and alerts" description="Everyone always gets messages in their CampusTwin notifications. Switch on email, SMS or WhatsApp to send them there too." />
      {canEdit
        ? <MessageChannels channels={channels} canEdit />
        : <p className="text-[13px] text-ink-700">Only the office can change these settings.</p>}
      <Card>
        <CardHeader title="Recently sent" action={<span className="text-[12px] text-ink-500">Last 50</span>} />
        <CardBody className="p-0">
          {deliveries.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-500">Nothing has been sent by email, SMS or WhatsApp yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#fafafa] text-left text-ink-500">
                  <tr><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Channel</th><th className="px-4 py-2 font-medium">To</th><th className="px-4 py-2 font-medium">Message</th><th className="px-4 py-2 font-medium">Status</th></tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-t border-hair">
                      <td className="whitespace-nowrap px-4 py-2">{new Date(d.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="px-4 py-2">{d.channel === "sms" ? "SMS" : d.channel === "whatsapp" ? "WhatsApp" : "Email"}{d.provider === "log" ? " (test)" : ""}</td>
                      <td className="px-4 py-2">{mask(d.to_address)}</td>
                      <td className="max-w-[320px] truncate px-4 py-2">{d.subject}</td>
                      <td className="px-4 py-2">
                        <span className={d.status === "sent" ? "text-up" : d.status === "failed" ? "text-down" : "text-ink-700"}>{STATUS[d.status] ?? d.status}</span>
                        {d.last_error && <span className="block text-[12px] text-ink-500">{d.last_error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
