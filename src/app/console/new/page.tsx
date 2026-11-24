import Link from "next/link";
import { createSchool, createUniversity } from "../actions";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const input = "w-full rounded-md border border-hair bg-white px-3 py-2 text-[14px] text-ink-900 outline-none focus:border-[#0F6CBD]";
const label = "block text-[12px] font-medium text-ink-700 mb-1";

export default function NewInstitutionPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-5"><Link href="/console" className="text-[13px] text-[#0F6CBD]">&larr; Institutions</Link></div>
      <h1 className="t-h1 text-ink-900">New institution</h1>

      <section className="mt-6 rounded-lg border border-hair bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink-900">A single school / college</h2>
        <p className="mt-1 text-[13px] text-ink-500">Its login will be at <span className="text-ink-700">slug.{BASE}</span>.</p>
        <form action={createSchool} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><label className={label}>Name</label><input name="name" required className={input} placeholder="Greenwood High School" /></div>
          <div><label className={label}>Subdomain slug</label><input name="slug" className={input} placeholder="greenwood" /></div>
          <div className="sm:col-span-2"><label className={label}>Place (optional)</label><input name="place" className={input} placeholder="Bengaluru" /></div>
          <div className="sm:col-span-2"><button className="rounded-md bg-[#0F6CBD] px-4 py-2 text-[13px] font-medium text-white">Create school</button></div>
        </form>
      </section>

      <section className="mt-5 rounded-lg border border-hair bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink-900">A university with campuses</h2>
        <p className="mt-1 text-[13px] text-ink-500">University landing at <span className="text-ink-700">uni-slug.{BASE}</span>; each campus at <span className="text-ink-700">campus-slug.{BASE}</span>.</p>
        <form action={createUniversity} className="mt-4 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label}>University name</label><input name="name" required className={input} placeholder="SRM University" /></div>
            <div><label className={label}>University slug</label><input name="slug" className={input} placeholder="srm" /></div>
          </div>
          <div>
            <label className={label}>Campuses — one per line, as <code>Name:slug</code></label>
            <textarea name="campuses" rows={4} className={input} placeholder={"SRM KTR:srmktr\nSRM Ramapuram:srmrmp\nSRM Vadapalani:srmvdp"} />
          </div>
          <div><button className="rounded-md bg-[#0F6CBD] px-4 py-2 text-[13px] font-medium text-white">Create university + campuses</button></div>
        </form>
      </section>
    </div>
  );
}
