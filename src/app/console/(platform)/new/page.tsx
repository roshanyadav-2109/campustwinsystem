import { createSchool, createUniversity } from "@/app/console/actions";
import { Section, inputCls, labelCls, btnPrimary } from "@/components/console/ui";
import { ZoneHeader } from "@/components/console/table";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const hint = "mt-1 text-[12px] text-cx-muted";

export default function NewInstitutionPage() {
  return (
    <div>
      <ZoneHeader title="New institution" sub="Pick the shape that matches the customer. Both go live on their own address straight away." />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Section title="School or college" desc="One institution with one portal">
          <form action={createSchool} className="space-y-4">
            <div>
              <label className={labelCls} htmlFor="s-name">Name</label>
              <input id="s-name" name="name" required className={inputCls} placeholder="Greenwood High School" />
            </div>
            <div>
              <label className={labelCls} htmlFor="s-slug">Web address</label>
              <input id="s-slug" name="slug" className={inputCls} placeholder="greenwood" />
              <p className={hint}>Its portal opens at greenwood.{BASE}</p>
            </div>
            <div>
              <label className={labelCls} htmlFor="s-place">Town or city</label>
              <input id="s-place" name="place" className={inputCls} placeholder="Bengaluru" />
              <p className={hint}>Optional, shown under the name on sign-in</p>
            </div>
            <div className="flex justify-end border-t border-cx-line pt-4"><button className={btnPrimary}>Create school</button></div>
          </form>
        </Section>

        <Section title="University with campuses" desc="One brand, a portal for every campus">
          <form action={createUniversity} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="u-name">University name</label>
                <input id="u-name" name="name" required className={inputCls} placeholder="SRM University" />
              </div>
              <div>
                <label className={labelCls} htmlFor="u-slug">Web address</label>
                <input id="u-slug" name="slug" className={inputCls} placeholder="srm" />
                <p className={hint}>Landing page at srm.{BASE}</p>
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="u-campuses">Campuses</label>
              <textarea id="u-campuses" name="campuses" rows={4} className={inputCls} placeholder={"SRM KTR:srmktr\nSRM Ramapuram:srmrmp\nSRM Vadapalani:srmvdp"} />
              <p className={hint}>One campus per line, written as name, colon, web address</p>
            </div>
            <div className="flex justify-end border-t border-cx-line pt-4"><button className={btnPrimary}>Create university and campuses</button></div>
          </form>
        </Section>
      </div>
    </div>
  );
}
