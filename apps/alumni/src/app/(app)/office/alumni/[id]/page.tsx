import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/context";
import { fmtDate, inr } from "@/lib/format";
import { PageHeader, Section, Empty, inputCls, labelCls, btnPrimary, linkCls, Status } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { ProfileFields } from "@/components/profile-fields";
import { updateAlumnus } from "../../../actions";

export const metadata = { title: "Alumnus" };

export default async function AlumnusRecord({ params }: { params: Promise<{ id: string }> }) {
  const { db, org } = await requireStaff();
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const id = Number(raw);
  const { data: m } = await db.from("member").select("*").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (!m) notFound();
  const { data: gifts } = await db.from("donation").select("id, amount, donated_on, receipt_number, status").eq("member_id", id).order("donated_on", { ascending: false });

  return (
    <div>
      <PageHeader title={m.full_name} sub={<Status tone={m.status === "verified" ? "ok" : m.status === "pending" ? "warn" : "off"}>{m.status === "verified" ? (m.user_id ? "Verified, has signed in" : "Verified, not signed in yet") : m.status === "pending" ? "Waiting for review" : "Declined"}</Status>} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Record">
          <ActionForm action={updateAlumnus} className="space-y-4">
            <input type="hidden" name="id" value={m.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="full_name" className={labelCls}>Full name</label><input id="full_name" name="full_name" required maxLength={150} defaultValue={m.full_name} className={inputCls} /></div>
              <div><label htmlFor="email" className={labelCls}>Email</label><input id="email" name="email" type="email" defaultValue={m.email ?? ""} className={inputCls} /></div>
              <div><label htmlFor="batch_year" className={labelCls}>Batch</label><input id="batch_year" name="batch_year" type="number" min={1900} max={2100} defaultValue={m.batch_year ?? ""} className={inputCls} /></div>
              <div><label htmlFor="roll_number" className={labelCls}>Roll number</label><input id="roll_number" name="roll_number" maxLength={40} defaultValue={m.roll_number ?? ""} className={inputCls} /></div>
            </div>
            <ProfileFields v={m} />
            <div className="grid gap-4 border-t border-cx-line pt-4 sm:grid-cols-2">
              <div>
                <label htmlFor="status" className={labelCls}>Status</label>
                <select id="status" name="status" defaultValue={m.status} className={inputCls}>
                  <option value="verified">Verified</option><option value="pending">Waiting for review</option><option value="rejected">Declined</option>
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-[13.5px] text-cx-text-2"><input type="checkbox" name="show_in_directory" defaultChecked={m.show_in_directory} className="h-4 w-4 accent-cx-text" /> Listed in the directory</label>
            </div>
            <Submit className={btnPrimary}>Save</Submit>
          </ActionForm>
          <p className="mt-3 text-[12.5px] text-cx-muted">Added {fmtDate(m.created_at)} {m.source === "self" ? "through the join link" : m.source === "import" ? "by import" : "by the alumni office"}.</p>
        </Section>
        <Section title="Giving" right={<Link href={`/office/donations?member=${m.id}`} className={linkCls}>Record a donation</Link>} flush>
          {gifts?.length ? (
            <ul className="divide-y divide-cx-line">
              {gifts.map((g) => (
                <li key={g.id} className="flex justify-between px-5 py-2.5 text-[14px]">
                  <span><Link href={`/giving/receipt/${g.id}`} className={linkCls}>{inr(g.amount)}</Link><span className="block text-[12.5px] text-cx-muted">{fmtDate(g.donated_on)}{g.status === "cancelled" ? ", cancelled" : ""}</span></span>
                  <span className="text-[12.5px] text-cx-muted">{g.receipt_number ?? "No 80G"}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No gifts recorded.</Empty>}
        </Section>
      </div>
    </div>
  );
}
