import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCampus } from "@/app/console/actions";
import { ConsoleTable, ZoneHeader, type Col } from "@/components/console/table";
import { Section, StatusBadge, inputCls, labelCls, btnPrimary } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
type Campus = { id: number; name: string; slug: string; status: string };

export default async function CampusesZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  const admin = createAdminClient();
  const { data: u } = await admin.from("university").select("id").eq("id", uid).maybeSingle();
  if (!u) notFound();
  const { data: campuses } = await admin.from("school").select("id, name, slug, status").eq("university_id", uid).order("name");
  const camps = (campuses ?? []) as Campus[];

  const cols: Col<Campus>[] = [
    { key: "name", label: "Campus", render: (x) => <Link href={`/console/school/${x.id}`} className="font-medium text-cx-text hover:text-cx-link">{x.name}</Link> },
    { key: "sub", label: "Subdomain", render: (x) => <a href={`https://${x.slug}.${BASE}`} target="_blank" rel="noreferrer" className="text-cx-link hover:underline">{x.slug}.{BASE}</a> },
    { key: "status", label: "Status", render: (x) => <StatusBadge status={x.status} /> },
    { key: "go", label: "", align: "right", render: (x) => <Link href={`/console/school/${x.id}`} className="rounded-md border border-cx-line px-2.5 py-1 text-[12px] font-medium text-cx-text-2 hover:bg-cx-raised">Manage</Link> },
  ];

  return (
    <div className="max-w-4xl">
      <ZoneHeader title="Campuses" sub={`${camps.length} campus${camps.length === 1 ? "" : "es"}`} />
      <ConsoleTable columns={cols} rows={camps} rowKey={(x) => x.id} empty="No campuses yet — add the first below" />
      <div className="mt-4">
        <Section title="Add a campus" desc="Creates a new tenant under this university with its own subdomain.">
          <form action={addCampus} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="universityId" value={uid} />
            <div className="min-w-[180px] flex-1"><label className={labelCls}>Campus name</label><input name="name" className={inputCls} placeholder="SRM Delhi-NCR" /></div>
            <div><label className={labelCls}>Subdomain slug</label><input name="slug" className={inputCls} placeholder="srmncr" /></div>
            <button className={btnPrimary}>Add campus</button>
          </form>
        </Section>
      </div>
    </div>
  );
}
