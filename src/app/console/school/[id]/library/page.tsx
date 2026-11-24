import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip } from "@/components/console/table";
import { EmptyState, btnGhost } from "@/components/console/ui";
import { ModuleNotice } from "@/components/console/module-notice";
import { Icon } from "@/components/console/icons";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

export default async function LibraryZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).library;
  const [{ count: books }, { count: issues }, { count: openLoans }] = await Promise.all([
    admin.from("library_book").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("library_issue").select("*", { count: "exact", head: true }).eq("school_id", s.id),
    admin.from("library_issue").select("*", { count: "exact", head: true }).eq("school_id", s.id).is("returned_on", null),
  ]);

  return (
    <div>
      <ZoneHeader title="Library" />
      {!on && <ModuleNotice module="library" schoolId={s.id} />}
      {(books ?? 0) > 0 ? (
        <div className={kpiStrip}>
          <Kpi label="Titles" value={books ?? 0} />
          <Kpi label="Loans so far" value={issues ?? 0} />
          <Kpi label="On loan now" value={openLoans ?? 0} />
        </div>
      ) : (
        <EmptyState
          icon={<Icon name="library" size={22} />}
          title="No books catalogued yet"
          body={`${s.name} hasn't added its catalogue. Once the librarian adds titles and starts issuing books, stock and loans show here.`}
          action={on ? <a href={`https://${s.slug}.${BASE}/dashboard/library`} target="_blank" rel="noreferrer" className={btnGhost}>Open the library in the school portal <Icon name="external" size={14} /></a> : undefined}
        />
      )}
    </div>
  );
}
