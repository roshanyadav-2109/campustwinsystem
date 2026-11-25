import Link from "next/link";
import { requireStaff } from "@/lib/context";
import { todayIST, fyOf, fmtDate, inr, MODE_LABEL } from "@/lib/format";
import { PageHeader, Section, Empty, Table, td, inputCls, labelCls, btnPrimary, btnGhost, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { recordDonation } from "../../actions";

export const metadata = { title: "Donations" };

export default async function Donations({ searchParams }: { searchParams: Promise<{ fy?: string; member?: string }> }) {
  const { db, org } = await requireStaff();
  const sp = await searchParams;
  const today = todayIST();
  const fy = /^\d{4}$/.test(sp.fy ?? "") ? fyOf(`${sp.fy}-04-01`) : fyOf(today);
  const memberId = Number(sp.member) || null;
  const [{ data: campaigns }, { data: rows }, member, { data: s }] = await Promise.all([
    db.from("campaign").select("id, title, eligible_80g").eq("org_id", org.id).eq("active", true).order("title"),
    db.from("donation").select("id, donor_name, donor_pan, amount, mode, donated_on, receipt_number, status, eligible_80g").eq("org_id", org.id).gte("donated_on", fy.start).lte("donated_on", fy.end).order("donated_on", { ascending: false }).order("id", { ascending: false }).limit(1000),
    memberId ? db.from("member").select("id, full_name, email").eq("org_id", org.id).eq("id", memberId).maybeSingle() : Promise.resolve({ data: null }),
    db.from("settings").select("reg_80g, fcra_registered").eq("org_id", org.id).single(),
  ]);
  const live = (rows ?? []).filter((r) => r.status === "recorded");
  const total = live.reduce((t, r) => t + Number(r.amount), 0);
  const with80g = live.filter((r) => r.eligible_80g).reduce((t, r) => t + Number(r.amount), 0);
  const fyStartYear = Number(fy.start.slice(0, 4));

  return (
    <div>
      <PageHeader title="Donations" sub={`Financial year ${fy.label}: ${inr(total)} received, ${inr(with80g)} with 80G receipts`}>
        <Link href={`/office/donations?fy=${fyStartYear - 1}`} className={btnGhost}>{fyStartYear - 1}-{String(fyStartYear % 100).padStart(2, "0")}</Link>
        <a href={`/office/donations/export?fy=${fyStartYear}`} className={btnGhost}>Download donor report</a>
      </PageHeader>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Section flush>
          {rows?.length ? (
            <Table head={[{ label: "Donor" }, { label: "Date" }, { label: "Mode" }, { label: "Receipt" }, { label: "Amount", right: true }]}>
              {rows.map((r) => (
                <tr key={r.id} className={r.status === "cancelled" ? "text-cx-faint" : ""}>
                  <td className={td}><Link href={`/giving/receipt/${r.id}`} className={linkCls}>{r.donor_name}</Link>{r.donor_pan && <div className="text-[12px] text-cx-muted">PAN {r.donor_pan}</div>}</td>
                  <td className={td}>{fmtDate(r.donated_on)}</td>
                  <td className={td}>{MODE_LABEL[r.mode]}</td>
                  <td className={td}>{r.status === "cancelled" ? "Cancelled" : r.receipt_number ?? "No 80G"}</td>
                  <td className={`${td} text-right tabular-nums`}>{inr(r.amount)}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No donations recorded in {fy.label}.</Empty>}
        </Section>

        <Section title="Record a donation">
          {!campaigns?.length ? <p className="text-[14px] text-cx-text-2">Add a campaign first, under <Link href="/giving" className={linkCls}>Giving</Link>.</p> : (
            <ActionForm action={recordDonation} reset className="space-y-3">
              {member.data && <input type="hidden" name="member_id" value={member.data.id} />}
              <div>
                <label htmlFor="campaign_id" className={labelCls}>Campaign</label>
                <select id="campaign_id" name="campaign_id" required className={inputCls}>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}{c.eligible_80g ? "" : " (no 80G)"}</option>)}
                </select>
              </div>
              <div><label htmlFor="donor_name" className={labelCls}>Donor&apos;s name</label><input id="donor_name" name="donor_name" required maxLength={150} defaultValue={member.data?.full_name ?? ""} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="amount" className={labelCls}>Amount (₹)</label><input id="amount" name="amount" required inputMode="decimal" className={`${inputCls} text-right tabular-nums`} /></div>
                <div><label htmlFor="donated_on" className={labelCls}>Date</label><input id="donated_on" name="donated_on" type="date" required defaultValue={today} max={today} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="mode" className={labelCls}>Paid by</label>
                  <select id="mode" name="mode" defaultValue="upi" className={inputCls}>
                    {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label htmlFor="reference" className={labelCls}>Cheque or UPI reference</label><input id="reference" name="reference" maxLength={80} className={inputCls} /></div>
              </div>
              <div>
                <label htmlFor="donor_citizenship" className={labelCls}>Donor is</label>
                <select id="donor_citizenship" name="donor_citizenship" defaultValue="indian" className={inputCls}>
                  <option value="indian">An Indian resident</option><option value="nri">An NRI (Indian citizen abroad)</option><option value="foreign">A foreign citizen (including OCI)</option>
                </select>
              </div>
              <div><label htmlFor="donor_pan" className={labelCls}>Donor&apos;s PAN (needed for 80G)</label><input id="donor_pan" name="donor_pan" maxLength={10} className={`${inputCls} uppercase`} /></div>
              <div><label htmlFor="donor_email" className={labelCls}>Donor&apos;s email</label><input id="donor_email" name="donor_email" type="email" defaultValue={member.data?.email ?? ""} className={inputCls} /></div>
              <div><label htmlFor="donor_address" className={labelCls}>Donor&apos;s address</label><textarea id="donor_address" name="donor_address" rows={2} maxLength={500} className={inputCls} /></div>
              <Submit className={btnPrimary} pending="Recording">Record donation</Submit>
              <p className="text-[12px] leading-5 text-cx-faint">An 80G receipt is issued automatically when the donation qualifies: the campaign is 80G-eligible{s?.reg_80g ? "" : " and your 80G registration is added in settings"}, the donor is Indian or an NRI with a PAN, and it is not cash above ₹2,000.{s?.fcra_registered ? "" : " Foreign citizens cannot donate until you record an FCRA registration."}</p>
            </ActionForm>
          )}
        </Section>
      </div>
    </div>
  );
}
