import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSetUp } from "@/lib/context";
import { fmtDate, inr } from "@/lib/format";
import { PageHeader, Section, Empty, btnPrimary, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { ProfileFields } from "@/components/profile-fields";
import { updateMyProfile } from "../actions";

export const metadata = { title: "My profile" };

export default async function Profile() {
  const { db, memberId } = await requireSetUp();
  if (!memberId) redirect("/home");
  const [{ data: m }, { data: gifts }] = await Promise.all([
    db.from("member").select("*").eq("id", memberId).single(),
    db.from("donation").select("id, amount, donated_on, receipt_number, status").eq("member_id", memberId).order("donated_on", { ascending: false }),
  ]);
  if (!m) redirect("/home");
  return (
    <div>
      <PageHeader title={m.full_name} sub={[m.batch_year && `Batch of ${m.batch_year}`, m.email].filter(Boolean).join(", ")} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="About you" desc="Your batch, roll number and email are kept by the alumni office; ask them to correct these.">
          <ActionForm action={updateMyProfile} className="space-y-4">
            <ProfileFields v={m} />
            <label className="flex items-center gap-2 text-[13.5px] text-cx-text-2">
              <input type="checkbox" name="show_in_directory" defaultChecked={m.show_in_directory} className="h-4 w-4 accent-cx-text" />
              Show me in the alumni directory
            </label>
            <Submit className={btnPrimary}>Save</Submit>
          </ActionForm>
        </Section>
        <Section title="Your giving" flush>
          {gifts?.length ? (
            <ul className="divide-y divide-cx-line">
              {gifts.map((g) => (
                <li key={g.id} className="flex items-center justify-between px-5 py-2.5 text-[14px]">
                  <span><span className="tabular-nums text-cx-text">{inr(g.amount)}</span><span className="block text-[12.5px] text-cx-muted">{fmtDate(g.donated_on)}{g.status === "cancelled" ? ", cancelled" : ""}</span></span>
                  {g.receipt_number && <Link href={`/giving/receipt/${g.id}`} className={linkCls}>80G receipt</Link>}
                </li>
              ))}
            </ul>
          ) : <Empty>No gifts recorded yet. <Link href="/giving" className={linkCls}>See campaigns</Link></Empty>}
        </Section>
      </div>
    </div>
  );
}
