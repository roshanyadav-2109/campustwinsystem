import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool } from "@/lib/console/tenant";
import { Pill, ZoneHeader } from "@/components/console/table";

type Row = { id: number; title: string; body: string; scope: string; published_at: string; staff: { full_name: string } | null };

export default async function AnnouncementsZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const { data } = await admin
    .from("announcement")
    .select("id, title, body, scope, published_at, staff:created_by(full_name)")
    .eq("school_id", s.id)
    .order("published_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div>
      <ZoneHeader title="Announcements" sub={`${rows.length} published`} />
      {rows.length > 0 ? (
        <div className="space-y-2.5">
          {rows.map((a) => (
            <div key={a.id} className="rounded-lg border border-hair bg-white p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[14px] font-semibold text-ink-900">{a.title}</h3>
                <span className="flex items-center gap-2 text-[11.5px] text-ink-400">
                  <Pill tone="sky">{a.scope}</Pill>
                  {a.staff?.full_name && <span>{a.staff.full_name}</span>}
                  <span>{new Date(a.published_at).toLocaleDateString()}</span>
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12.5px] text-ink-600">{a.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-hair px-4 py-10 text-center text-[13px] text-ink-500">No announcements yet.</p>
      )}
    </div>
  );
}
