import { createClient } from "@/lib/supabase/server";

// An invigilator's coming duties (shown only when there are some).
export async function DutiesPanel() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_duties" as never);
  const rows = (data ?? []) as unknown as { session_name: string; exam_date: string; starts_at: string; room: string; candidates: number }[];
  if (!rows.length) return null;
  return (
    <section className="mb-4 rounded-md border border-hair bg-surface p-4">
      <div className="flex items-center justify-between"><div className="text-[16px] font-semibold text-ink-900">Your invigilation duties</div><a href="/dashboard/invigilation" className="text-[13px] text-[#0F6CBD] hover:underline">Open rosters</a></div>
      <ul className="mt-2 space-y-1 text-[13px]">{rows.slice(0, 8).map((r, i) => <li key={i}>{r.exam_date} {r.starts_at.slice(0, 5)}: {r.room} ({r.candidates} candidates), {r.session_name}</li>)}</ul>
    </section>
  );
}
