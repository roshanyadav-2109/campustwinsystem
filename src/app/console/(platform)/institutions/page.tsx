import Link from "next/link";
import { InstitutionsTable } from "@/components/console/institutions-table";
import { institutionRows } from "@/lib/console/institutions";
import { ZoneHeader } from "@/components/console/table";
import { btnPrimary } from "@/components/console/ui";

export default async function InstitutionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const rows = await institutionRows();
  return (
    <div>
      <ZoneHeader title="Institutions">
        <Link href="/console/new" className={btnPrimary}>New institution</Link>
      </ZoneHeader>
      <InstitutionsTable rows={rows} initialQuery={q ?? ""} />
    </div>
  );
}
