import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateBranding, setPlan, setUniversityStatus, addCampus, assignCentralAdmin } from "../../actions";
import { PageHeader, Section, StatusBadge, TypeBadge, inputCls, labelCls, btnPrimary, btnGhost, btnDanger } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

export default async function EditUniversityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  const admin = createAdminClient();
  const { data: u } = await admin.from("university").select("id, name, slug, plan, status, logo_url, primary_color").eq("id", uid).maybeSingle();
  if (!u) notFound();
  const [{ data: campuses }, { data: admins }] = await Promise.all([
    admin.from("school").select("id, name, slug, status").eq("university_id", uid).order("name"),
    admin.from("profile").select("id, full_name").eq("university_id", uid),
  ]);
  const camps = campuses ?? [];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={u.name}
        subdomain={`${u.slug}.${BASE}`}
        badge={<><TypeBadge kind="university" /><StatusBadge status={u.status ?? "active"} /></>}
      >
        <form action={setUniversityStatus}>
          <input type="hidden" name="id" value={u.id} />
          <input type="hidden" name="status" value={u.status === "active" ? "suspended" : "active"} />
          <button className={u.status === "active" ? btnDanger : btnPrimary}>{u.status === "active" ? "Suspend university" : "Activate university"}</button>
        </form>
      </PageHeader>

      <div className="space-y-5">
        <Section title="Branding" desc="Shown on the university landing page.">
          <form action={updateBranding} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={u.id} /><input type="hidden" name="kind" value="university" />
            <div><label className={labelCls}>Name</label><input name="name" defaultValue={u.name} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Primary colour</label>
              <div className="flex items-center gap-2">
                <span className="h-9 w-9 shrink-0 rounded-md border border-hair" style={{ background: u.primary_color ?? "#0F6CBD" }} />
                <input name="primary_color" defaultValue={u.primary_color ?? "#0F6CBD"} className={inputCls} />
              </div>
            </div>
            <div className="sm:col-span-2"><label className={labelCls}>Logo URL</label><input name="logo_url" defaultValue={u.logo_url ?? ""} className={inputCls} /></div>
            <div className="sm:col-span-2"><button className={btnPrimary}>Save branding</button></div>
          </form>
        </Section>

        <Section title="Campuses" desc={`${camps.length} campus${camps.length === 1 ? "" : "es"} under this university.`}>
          {camps.length > 0 ? (
            <ul className="mb-4 divide-y divide-hair rounded-lg border border-hair">
              {camps.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/console/school/${c.id}`} className="text-[13.5px] font-medium text-ink-900 hover:text-[#0F6CBD]">{c.name}</Link>
                    <div className="text-[11.5px] text-ink-400">{c.slug}.{BASE}</div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <StatusBadge status={c.status ?? "active"} />
                    <Link href={`/console/school/${c.id}`} className="text-[12px] font-medium text-[#0F6CBD] hover:underline">Manage</Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 rounded-lg border border-dashed border-hair px-4 py-6 text-center text-[13px] text-ink-500">No campuses yet. Add the first one below.</p>
          )}
          <form action={addCampus} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="universityId" value={u.id} />
            <div className="min-w-[180px] flex-1"><label className={labelCls}>Campus name</label><input name="name" className={inputCls} placeholder="SRM Delhi-NCR" /></div>
            <div><label className={labelCls}>Subdomain slug</label><input name="slug" className={inputCls} placeholder="srmncr" /></div>
            <button className={btnPrimary}>Add campus</button>
          </form>
        </Section>

        <Section title="Central admins" desc="They see and manage every campus, with a campus switcher. The person must already have an account on one campus.">
          <ul className="mb-4 space-y-1.5 text-[13px] text-ink-700">
            {(admins ?? []).map((a) => <li key={a.id} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#0F6CBD]" />{a.full_name}</li>)}
            {(admins?.length ?? 0) === 0 && <li className="text-ink-500">None assigned yet.</li>}
          </ul>
          <form action={assignCentralAdmin} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="universityId" value={u.id} />
            <div className="min-w-[200px] flex-1"><label className={labelCls}>Assign by account email</label><input name="email" type="email" className={inputCls} placeholder="admin@srm.edu" /></div>
            <button className={btnGhost}>Assign</button>
          </form>
        </Section>

        <Section title="Plan" desc="Billing tier for the whole university.">
          <form action={setPlan} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={u.id} /><input type="hidden" name="kind" value="university" />
            <div className="min-w-[200px] flex-1"><label className={labelCls}>Plan name</label><input name="plan" defaultValue={u.plan ?? "standard"} className={inputCls} /></div>
            <button className={btnGhost}>Update plan</button>
          </form>
        </Section>
      </div>
    </div>
  );
}
