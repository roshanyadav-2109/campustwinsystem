import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip } from "@/components/console/table";
import { ModuleNotice } from "@/components/console/module-notice";

export default async function LibraryZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).library;
  const [{ count: books }, { count: issues }] = await Promise.all([
    admin.from("library_book").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("library_issue").select("*", { count: "exact", head: true }).eq("school_id", s.id),
  ]);
  const { count: openLoans } = await admin.from("library_issue").select("*", { count: "exact", head: true }).eq("school_id", s.id).is("returned_on", null);

  return (
    <div>
      <ZoneHeader title="Library" />
      {!on && <ModuleNotice module="library" schoolId={s.id} />}
      <div className={kpiStrip}>
        <Kpi label="Titles" value={books ?? 0} />
        <Kpi label="Total loans" value={issues ?? 0} />
        <Kpi label="On loan now" value={openLoans ?? 0} />
      </div>
      {(books ?? 0) === 0 && (
        <p className="rounded-lg border border-dashed border-cx-line px-4 py-10 text-center text-[13px] text-cx-muted">
          No books catalogued yet. The catalogue and issue desk live in the school portal.
        </p>
      )}
    </div>
  );
}
