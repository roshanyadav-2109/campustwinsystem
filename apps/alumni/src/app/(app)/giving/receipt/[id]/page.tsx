import { notFound } from "next/navigation";
import { requireSetUp } from "@/lib/context";
import { fmtDate, inr, rupeesInWords, MODE_LABEL, CITIZEN_LABEL, FUND_LABEL } from "@/lib/format";
import { PageHeader, Section, btnDanger, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { cancelDonation } from "../../../actions";

export const metadata = { title: "Receipt" };

const PAID_BY: Record<string, string> = { cash: "in cash", cheque: "by cheque", bank_transfer: "by bank transfer", upi: "by UPI", card: "by card", other: "" };

// The donation and, when it qualifies, its 80G receipt. Donors see their own;
// the alumni office sees all (row security).
export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { db, org, isStaff } = await requireSetUp();
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const { data: d } = await db.from("donation").select("*, campaign:campaign!donation_org_id_campaign_id_fkey(title, fund_type)").eq("org_id", org.id).eq("id", Number(raw)).maybeSingle();
  if (!d) notFound();
  const { data: s } = await db.from("settings").select("display_name, address, pan, reg_80g, reg_80g_valid_until").eq("org_id", org.id).single();
  const c = d.campaign as unknown as { title: string; fund_type: string } | null;
  const cancelled = d.status === "cancelled";

  return (
    <div>
      <PageHeader title={d.receipt_number ? `Receipt ${d.receipt_number}` : "Donation"} sub={cancelled ? <Status tone="bad">Cancelled</Status> : d.eligible_80g ? <Status tone="ok">80G receipt</Status> : <Status tone="off">No 80G receipt: {d.not_eligible_why}</Status>}>
        {isStaff && !cancelled && <ActionForm action={cancelDonation}><input type="hidden" name="id" value={d.id} /><Submit className={btnDanger} pending="Cancelling">Cancel donation</Submit></ActionForm>}
      </PageHeader>
      <div className="max-w-[760px]">
        <Section>
          <div className="flex flex-wrap justify-between gap-4 border-b border-cx-line pb-4">
            <div>
              <p className="text-[18px] font-semibold text-cx-text">{s?.display_name ?? org.name}</p>
              {s?.address && <p className="whitespace-pre-line text-[13.5px] text-cx-text-2">{s.address}</p>}
              {s?.pan && <p className="text-[13.5px] text-cx-text-2">PAN {s.pan}</p>}
            </div>
            <div className="text-right text-[13.5px]">
              {d.receipt_number && <p className="font-medium text-cx-text">Receipt {d.receipt_number}</p>}
              <p className="text-cx-text-2">Date {fmtDate(d.donated_on)}</p>
            </div>
          </div>
          <p className="py-4 text-[14.5px] leading-7 text-cx-text-2">
            Received with thanks from <b className="font-semibold text-cx-text">{d.donor_name}</b>
            {d.donor_pan && <> (PAN {d.donor_pan})</>}
            {d.donor_address && <>, {d.donor_address}</>}, the sum of <b className="font-semibold text-cx-text">{inr(d.amount)}</b> ({rupeesInWords(Number(d.amount))})
            {" "}{PAID_BY[d.mode] ?? ""}{d.reference ? ` (${d.reference})` : ""}, as a donation towards <b className="font-semibold text-cx-text">{c?.title}</b>{c ? ` (${FUND_LABEL[c.fund_type].toLowerCase()} fund)` : ""}.
          </p>
          {d.eligible_80g && s?.reg_80g && (
            <p className="border-t border-cx-line pt-4 text-[13px] leading-6 text-cx-text-2">
              This donation is eligible for deduction under section 80G of the Income-tax Act. Registration number {s.reg_80g}{s.reg_80g_valid_until ? `, valid until ${fmtDate(s.reg_80g_valid_until)}` : ""}. The donor certificate for the annual return is issued separately after the institution files its statement of donations.
            </p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-cx-line pt-4 text-[13px] sm:grid-cols-4">
            <div><dt className="text-cx-muted">Donor</dt><dd className="text-cx-text">{CITIZEN_LABEL[d.donor_citizenship]}</dd></div>
            <div><dt className="text-cx-muted">Mode</dt><dd className="text-cx-text">{MODE_LABEL[d.mode]}</dd></div>
            <div><dt className="text-cx-muted">Amount</dt><dd className="tabular-nums text-cx-text">{inr(d.amount)}</dd></div>
            <div><dt className="text-cx-muted">Status</dt><dd className="text-cx-text">{cancelled ? "Cancelled" : "Recorded"}</dd></div>
          </dl>
        </Section>
      </div>
    </div>
  );
}
