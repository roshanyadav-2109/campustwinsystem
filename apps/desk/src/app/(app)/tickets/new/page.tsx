import { requireSetUp } from "@/lib/context";
import { PageHeader, Section, inputCls, labelCls, btnPrimary } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { logTicket } from "../../actions";

export const metadata = { title: "Log a request" };

// For requests that arrive by phone, at the counter or by letter.
export default async function NewTicket() {
  const { db, org } = await requireSetUp();
  const { data: cats } = await db.from("category").select("id, name").eq("org_id", org.id).eq("active", true).order("name");
  return (
    <div>
      <PageHeader title="Log a request" sub="For requests that come by phone, at the counter or on paper" />
      <div className="max-w-[760px]">
        <Section>
          <ActionForm action={logTicket} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-1"><label htmlFor="requester_name" className={labelCls}>From</label><input id="requester_name" name="requester_name" required maxLength={150} className={inputCls} /></div>
              <div><label htmlFor="requester_phone" className={labelCls}>Phone</label><input id="requester_phone" name="requester_phone" type="tel" maxLength={20} className={inputCls} /></div>
              <div><label htmlFor="requester_email" className={labelCls}>Email</label><input id="requester_email" name="requester_email" type="email" className={inputCls} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="kind" className={labelCls}>Type</label>
                <select id="kind" name="kind" defaultValue="request" className={inputCls}><option value="request">Request</option><option value="complaint">Complaint</option><option value="grievance">Grievance</option></select>
              </div>
              <div>
                <label htmlFor="priority" className={labelCls}>Priority</label>
                <select id="priority" name="priority" defaultValue="normal" className={inputCls}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
              </div>
              <div>
                <label htmlFor="category_id" className={labelCls}>About</label>
                <select id="category_id" name="category_id" defaultValue="" className={inputCls}>
                  <option value="">Not set</option>{(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div><label htmlFor="subject" className={labelCls}>Subject</label><input id="subject" name="subject" required maxLength={200} className={inputCls} /></div>
            <div><label htmlFor="description" className={labelCls}>What they said</label><textarea id="description" name="description" required rows={5} maxLength={8000} className={inputCls} /></div>
            <label className="flex items-center gap-2 text-[13.5px] text-cx-text-2"><input type="checkbox" name="assign_me" defaultChecked className="h-4 w-4 accent-cx-text" /> Assign it to me</label>
            <Submit className={btnPrimary} pending="Logging">Log request</Submit>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
