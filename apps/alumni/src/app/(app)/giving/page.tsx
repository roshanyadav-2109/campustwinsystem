import Link from "next/link";
import { requireSetUp } from "@/lib/context";
import { inrShort, FUND_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, inputCls, labelCls, btnPrimary, btnQuiet, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { saveCampaign, toggleCampaign } from "../actions";

export const metadata = { title: "Giving" };

export default async function Giving() {
  const { db, org, isStaff } = await requireSetUp();
  const [{ data: campaigns }, { data: raised }, { data: s }] = await Promise.all([
    db.from("campaign").select("id, title, description, goal, fund_type, eligible_80g, active").eq("org_id", org.id).order("active", { ascending: false }).order("created_at", { ascending: false }),
    isStaff ? db.from("donation").select("campaign_id, amount").eq("org_id", org.id).eq("status", "recorded").limit(50000) : Promise.resolve({ data: [] as { campaign_id: number; amount: number }[] }),
    db.from("settings").select("reg_80g").eq("org_id", org.id).single(),
  ]);
  const sum = new Map<number, number>();
  for (const d of raised ?? []) sum.set(d.campaign_id, (sum.get(d.campaign_id) ?? 0) + Number(d.amount));
  const shown = (campaigns ?? []).filter((c) => c.active || isStaff);

  return (
    <div>
      <PageHeader title="Giving" sub="Support your institution">
        {isStaff && <Link href="/office/donations" className={btnPrimary}>Record a donation</Link>}
      </PageHeader>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section flush>
          {shown.length ? (
            <ul className="divide-y divide-cx-line">
              {shown.map((c) => {
                const got = sum.get(c.id) ?? 0;
                const pct = c.goal ? Math.min(100, Math.round((got / Number(c.goal)) * 100)) : null;
                return (
                  <li key={c.id} className={`px-5 py-4 ${c.active ? "" : "opacity-60"}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[15.5px] font-semibold text-cx-text">{c.title}</p>
                      {isStaff && <ActionForm action={toggleCampaign}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? "0" : "1"} /><Submit className={btnQuiet}>{c.active ? "Close" : "Reopen"}</Submit></ActionForm>}
                    </div>
                    <p className="text-[12.5px] text-cx-muted">{FUND_LABEL[c.fund_type]} fund{c.eligible_80g && s?.reg_80g ? ", tax benefit under section 80G" : ""}{!c.active ? ", closed" : ""}</p>
                    {c.description && <p className="mt-1.5 whitespace-pre-line text-[14px] leading-6 text-cx-text-2">{c.description}</p>}
                    {isStaff && (
                      <div className="mt-2.5">
                        {pct !== null && (
                          <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-cx-raised" role="img" aria-label={`${pct}% of the goal raised`}>
                            <div className="h-full rounded-full bg-cx-text" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        <p className="mt-1 text-[12.5px] tabular-nums text-cx-muted">{inrShort(got)} raised{c.goal ? ` of ${inrShort(c.goal)}` : ""}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : <Empty>No campaigns yet.</Empty>}
        </Section>
        {isStaff ? (
          <Section title="New campaign">
            <ActionForm action={saveCampaign} reset className="space-y-3">
              <div><label htmlFor="title" className={labelCls}>Title</label><input id="title" name="title" required maxLength={160} placeholder="New library wing" className={inputCls} /></div>
              <div><label htmlFor="goal" className={labelCls}>Goal in rupees (optional)</label><input id="goal" name="goal" inputMode="numeric" className={inputCls} /></div>
              <div>
                <label htmlFor="fund_type" className={labelCls}>Kind of fund</label>
                <select id="fund_type" name="fund_type" defaultValue="specific" className={inputCls}>
                  <option value="specific">Specific purpose</option><option value="corpus">Corpus (endowment)</option><option value="general">General</option>
                </select>
              </div>
              <div><label htmlFor="description" className={labelCls}>What it is for</label><textarea id="description" name="description" rows={3} maxLength={4000} className={inputCls} /></div>
              <label className="flex items-center gap-2 text-[13.5px] text-cx-text-2"><input type="checkbox" name="eligible_80g" defaultChecked className="h-4 w-4 accent-cx-text" /> Donations qualify for 80G</label>
              <Submit className={btnPrimary} pending="Adding">Add campaign</Submit>
            </ActionForm>
            {!s?.reg_80g && <p className="mt-3 text-[12.5px] text-cx-muted">Add your 80G registration in <Link href="/office/settings" className={linkCls}>settings</Link> to issue 80G receipts.</p>}
          </Section>
        ) : (
          <Section title="How to give">
            <p className="text-[14px] leading-6 text-cx-text-2">Contact the alumni office to give by cheque, bank transfer or UPI. Your 80G receipt will appear under <Link href="/profile" className={linkCls}>My profile</Link>.</p>
          </Section>
        )}
      </div>
    </div>
  );
}
