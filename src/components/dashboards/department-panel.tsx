import Link from "@/components/ui/hover-link";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/session";
import { CiaSignoff } from "@/components/dashboards/cia-signoff";

// Home for a Head of Department, Dean or Programme Coordinator: what waits in
// their department, faculty or programme. Counts come through the database's
// scope rules, so they only ever cover the person's own area.
export async function DepartmentPanel({ session }: { session: Session }) {
  const supabase = await createClient();
  const { data: sem } = await supabase.from("semester" as never).select("id").eq("is_current", true).maybeSingle();
  const semId = (sem as unknown as { id: number } | null)?.id ?? 0;
  const [{ data: secs }, { count: waiting }, { data: queue }] = await Promise.all([
    supabase.rpc("my_scope_sections" as never),
    supabase.from("course_registration" as never).select("id", { count: "exact", head: true }).eq("semester_id", semId).eq("status", "registered"),
    supabase.rpc("my_relaxation_queue" as never),
  ]);
  const sections = (secs ?? []) as unknown as { id: number; label: string }[];
  const { data: cia } = semId ? await supabase.rpc("cia_signoff_status" as never, { p_semester: semId } as never) : { data: [] };
  const approvals = ((queue ?? []) as unknown[]).length;
  const what = session.accessTypes.includes("dean") ? "faculty" : session.accessTypes.includes("dept_head") ? "department" : "programme";
  const tiles = [
    { href: "/dashboard/courses", n: waiting ?? 0, label: "Course choices waiting for approval" },
    { href: "/dashboard/relaxations", n: approvals, label: "Relaxations waiting for you" },
    { href: "/dashboard/lectures", n: sections.length, label: "Sections (attendance shortage)" },
    { href: "/dashboard/results", n: sections.length, label: "Sections (results preview)" },
  ];
  return (
    <section className="mb-4 rounded-md border border-hair bg-surface p-4">
      <div className="text-[16px] font-semibold text-ink-900">Your {what}</div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-sm border border-hair bg-white p-3 hover:bg-panel">
            <div className="text-[22px] font-semibold tabular text-ink-900">{t.n}</div>
            <div className="text-[12px] text-ink-700">{t.label}</div>
          </Link>
        ))}
      </div>
      {sections.length > 0 && <p className="mt-3 text-[12px] text-ink-500">{sections.map((s) => s.label).join(", ")}</p>}
      <CiaSignoff semesterId={semId} rows={(cia ?? []) as unknown as { section_id: number; section_label: string; subject_id: number; subject_name: string; signed: boolean }[]} />
    </section>
  );
}
