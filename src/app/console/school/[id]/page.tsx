import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateBranding, setPlan, toggleModule, setSchoolStatus } from "../../actions";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const GATEABLE = ["twin", "fees", "library", "homework", "admissions", "hr", "transport"] as const;
const input = "w-full rounded-md border border-hair bg-white px-3 py-2 text-[14px] text-ink-900 outline-none focus:border-[#0F6CBD]";
const label = "block text-[12px] font-medium text-ink-700 mb-1";

export default async function EditSchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: s } = await admin.from("school").select("id, name, slug, place, plan, status, modules, university_id, logo_url, primary_color").eq("id", Number(id)).maybeSingle();
  if (!s) notFound();
  const mods = (s.modules as Record<string, boolean> | null) ?? {};

  return (
    <div className="max-w-2xl">
      <div className="mb-5"><Link href="/console" className="text-[13px] text-[#0F6CBD]">&larr; Institutions</Link></div>
      <h1 className="t-h1 text-ink-900">{s.name}</h1>
      <a href={`https://${s.slug}.${BASE}`} target="_blank" rel="noreferrer" className="text-[13px] text-[#0F6CBD] hover:underline">{s.slug}.{BASE}</a>
      {s.university_id && <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[11px] text-ink-500">campus</span>}

      <section className="mt-5 rounded-lg border border-hair bg-surface p-5">
        <h2 className="text-[14px] font-semibold text-ink-900">Branding</h2>
        <form action={updateBranding} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value="school" />
          <div><label className={label}>Name</label><input name="name" defaultValue={s.name} className={input} /></div>
          <div><label className={label}>Place</label><input name="place" defaultValue={s.place ?? ""} className={input} /></div>
          <div><label className={label}>Primary colour</label><input name="primary_color" defaultValue={s.primary_color ?? "#0F6CBD"} className={input} /></div>
          <div><label className={label}>Logo URL</label><input name="logo_url" defaultValue={s.logo_url ?? ""} className={input} /></div>
          <div className="sm:col-span-2"><button className="rounded-md bg-[#0F6CBD] px-4 py-2 text-[13px] font-medium text-white">Save branding</button></div>
        </form>
      </section>

      <section className="mt-4 rounded-lg border border-hair bg-surface p-5">
        <h2 className="text-[14px] font-semibold text-ink-900">Modules</h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {GATEABLE.map((k) => (
            <form key={k} action={toggleModule}>
              <input type="hidden" name="id" value={s.id} /><input type="hidden" name="key" value={k} />
              <button className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${mods[k] ? "bg-[#0F6CBD] text-white" : "bg-panel text-ink-500 hover:text-ink-900"}`}>{k}</button>
            </form>
          ))}
        </div>
      </section>

      <section className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-hair bg-surface p-5">
        <form action={setPlan} className="flex items-end gap-2">
          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="kind" value="school" />
          <div><label className={label}>Plan</label><input name="plan" defaultValue={s.plan ?? "standard"} className={input} /></div>
          <button className="rounded-md border border-hair px-3 py-2 text-[13px] text-ink-700 hover:bg-panel">Set plan</button>
        </form>
        <form action={setSchoolStatus} className="ml-auto">
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="status" value={s.status === "active" ? "suspended" : "active"} />
          <button className="rounded-md border border-hair px-3 py-2 text-[13px] text-ink-700 hover:bg-panel">{s.status === "active" ? "Suspend institution" : "Activate institution"}</button>
        </form>
      </section>
    </div>
  );
}
