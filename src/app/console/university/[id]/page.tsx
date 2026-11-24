import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateBranding, setPlan, setUniversityStatus, addCampus, assignCentralAdmin } from "../../actions";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const input = "w-full rounded-md border border-hair bg-white px-3 py-2 text-[14px] text-ink-900 outline-none focus:border-[#0F6CBD]";
const label = "block text-[12px] font-medium text-ink-700 mb-1";

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

  return (
    <div className="max-w-2xl">
      <div className="mb-5"><Link href="/console" className="text-[13px] text-[#0F6CBD]">&larr; Institutions</Link></div>
      <h1 className="t-h1 text-ink-900">{u.name}</h1>
      <a href={`https://${u.slug}.${BASE}`} target="_blank" rel="noreferrer" className="text-[13px] text-[#0F6CBD] hover:underline">{u.slug}.{BASE}</a>

      <section className="mt-5 rounded-lg border border-hair bg-surface p-5">
        <h2 className="text-[14px] font-semibold text-ink-900">Branding</h2>
        <form action={updateBranding} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={u.id} /><input type="hidden" name="kind" value="university" />
          <div><label className={label}>Name</label><input name="name" defaultValue={u.name} className={input} /></div>
          <div><label className={label}>Primary colour</label><input name="primary_color" defaultValue={u.primary_color ?? "#0F6CBD"} className={input} /></div>
          <div className="sm:col-span-2"><label className={label}>Logo URL</label><input name="logo_url" defaultValue={u.logo_url ?? ""} className={input} /></div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <button className="rounded-md bg-[#0F6CBD] px-4 py-2 text-[13px] font-medium text-white">Save branding</button>
            <form action={setUniversityStatus}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="status" value={u.status === "active" ? "suspended" : "active"} /><button className="rounded-md border border-hair px-3 py-2 text-[13px] text-ink-700 hover:bg-panel">{u.status === "active" ? "Suspend" : "Activate"}</button></form>
          </div>
        </form>
      </section>

      <section className="mt-4 rounded-lg border border-hair bg-surface p-5">
        <h2 className="text-[14px] font-semibold text-ink-900">Campuses ({campuses?.length ?? 0})</h2>
        <ul className="mt-2 divide-y divide-hair">
          {(campuses ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-[13px]">
              <span><Link href={`/console/school/${c.id}`} className="font-medium text-ink-900 hover:text-[#0F6CBD]">{c.name}</Link> <span className="text-ink-500">· {c.slug}.{BASE} · {c.status}</span></span>
              <Link href={`/console/school/${c.id}`} className="text-[12px] text-[#0F6CBD]">Edit</Link>
            </li>
          ))}
        </ul>
        <form action={addCampus} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="universityId" value={u.id} />
          <div className="flex-1"><label className={label}>Add campus — name</label><input name="name" className={input} placeholder="SRM Delhi-NCR" /></div>
          <div><label className={label}>slug</label><input name="slug" className={input} placeholder="srmncr" /></div>
          <button className="rounded-md bg-[#0F6CBD] px-4 py-2 text-[13px] font-medium text-white">Add</button>
        </form>
      </section>

      <section className="mt-4 rounded-lg border border-hair bg-surface p-5">
        <h2 className="text-[14px] font-semibold text-ink-900">Central admins</h2>
        <p className="mt-1 text-[12px] text-ink-500">Central admins see and manage all campuses (with a campus switcher). The person must already have an account on one of the campuses.</p>
        <ul className="mt-2 text-[13px] text-ink-700">
          {(admins ?? []).map((a) => <li key={a.id}>• {a.full_name}</li>)}
          {(admins?.length ?? 0) === 0 && <li className="text-ink-500">None yet.</li>}
        </ul>
        <form action={assignCentralAdmin} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="universityId" value={u.id} />
          <div className="flex-1"><label className={label}>Assign by account email</label><input name="email" type="email" className={input} placeholder="admin@srm.edu" /></div>
          <button className="rounded-md border border-hair px-3 py-2 text-[13px] text-ink-700 hover:bg-panel">Assign</button>
        </form>
      </section>

      <section className="mt-4 rounded-lg border border-hair bg-surface p-5">
        <form action={setPlan} className="flex items-end gap-2">
          <input type="hidden" name="id" value={u.id} /><input type="hidden" name="kind" value="university" />
          <div><label className={label}>Plan</label><input name="plan" defaultValue={u.plan ?? "standard"} className={input} /></div>
          <button className="rounded-md border border-hair px-3 py-2 text-[13px] text-ink-700 hover:bg-panel">Set plan</button>
        </form>
      </section>
    </div>
  );
}
