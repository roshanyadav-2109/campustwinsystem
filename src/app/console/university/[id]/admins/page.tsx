import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignCentralAdmin } from "@/app/console/actions";
import { ZoneHeader } from "@/components/console/table";
import { Section, inputCls, labelCls, btnPrimary } from "@/components/console/ui";

export default async function AdminsZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  const admin = createAdminClient();
  const { data: u } = await admin.from("university").select("id").eq("id", uid).maybeSingle();
  if (!u) notFound();
  const { data: admins } = await admin.from("profile").select("id, full_name, active_campus_id").eq("university_id", uid);
  const rows = admins ?? [];

  return (
    <div className="max-w-2xl">
      <ZoneHeader title="Central admins" sub="They see and manage every campus, with a campus switcher." />
      <Section title="Current central admins">
        <ul className="space-y-1.5 text-[13px] text-cx-text-2">
          {rows.map((a) => <li key={a.id} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-cx-text" />{a.full_name}</li>)}
          {rows.length === 0 && <li className="text-cx-muted">None assigned yet</li>}
        </ul>
        <form action={assignCentralAdmin} className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="universityId" value={uid} />
          <div className="min-w-[220px] flex-1"><label className={labelCls}>Assign by account email</label><input name="email" type="email" className={inputCls} placeholder="admin@srm.edu" /></div>
          <button className={btnPrimary}>Assign</button>
        </form>
        <p className="mt-2 text-[12px] text-cx-muted">The person must already have a login on one of this university&apos;s campuses.</p>
      </Section>
    </div>
  );
}
