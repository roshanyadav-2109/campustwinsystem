import { createSchool, createUniversity } from "@/app/console/actions";
import { PageHeader, Section, inputCls, labelCls, btnPrimary } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

export default function NewInstitutionPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="New institution" />
      <div className="space-y-5">
        <Section title="A single school or college" desc={`Its portal will live at slug.${BASE}.`}>
          <form action={createSchool} className="grid gap-4 sm:grid-cols-2">
            <div><label className={labelCls}>Name</label><input name="name" required className={inputCls} placeholder="Greenwood High School" /></div>
            <div><label className={labelCls}>Subdomain slug</label><input name="slug" className={inputCls} placeholder="greenwood" /></div>
            <div className="sm:col-span-2"><label className={labelCls}>Place (optional)</label><input name="place" className={inputCls} placeholder="Bengaluru" /></div>
            <div className="sm:col-span-2"><button className={btnPrimary}>Create school</button></div>
          </form>
        </Section>

        <Section title="A university with campuses" desc={`Landing at uni-slug.${BASE}; each campus at campus-slug.${BASE}.`}>
          <form action={createUniversity} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={labelCls}>University name</label><input name="name" required className={inputCls} placeholder="SRM University" /></div>
              <div><label className={labelCls}>University slug</label><input name="slug" className={inputCls} placeholder="srm" /></div>
            </div>
            <div>
              <label className={labelCls}>Campuses — one per line, as <code className="rounded bg-panel px-1 py-0.5 text-[11px]">Name:slug</code></label>
              <textarea name="campuses" rows={4} className={inputCls} placeholder={"SRM KTR:srmktr\nSRM Ramapuram:srmrmp\nSRM Vadapalani:srmvdp"} />
            </div>
            <div><button className={btnPrimary}>Create university + campuses</button></div>
          </form>
        </Section>
      </div>
    </div>
  );
}
