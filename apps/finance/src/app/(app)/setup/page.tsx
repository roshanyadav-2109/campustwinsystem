import { redirect } from "next/navigation";
import { getCtx } from "@/lib/context";
import { STATES } from "@/lib/format";
import { PageHeader, Section, inputCls, labelCls, btnPrimary } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { setupBooks } from "../actions";

export const metadata = { title: "Set up the books" };

export default async function Setup() {
  const { org, setUp, isAdmin } = await getCtx();
  if (setUp || !isAdmin) redirect("/home");
  return (
    <div>
      <PageHeader title="Set up the books" sub={org.name} />
      <div className="max-w-[640px]">
        <Section>
          <ActionForm action={setupBooks} className="space-y-4">
            <div>
              <label htmlFor="legal_name" className={labelCls}>Legal name (on invoices)</label>
              <input id="legal_name" name="legal_name" maxLength={200} defaultValue={org.name} className={inputCls} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="state_code" className={labelCls}>State</label>
                <select id="state_code" name="state_code" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Choose</option>
                  {STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="gstin" className={labelCls}>GSTIN (if registered)</label>
                <input id="gstin" name="gstin" maxLength={15} className={`${inputCls} uppercase`} />
              </div>
            </div>
            <p className="text-[13px] leading-5 text-cx-muted">Your state decides whether GST is split into CGST and SGST (same state) or charged as IGST (another state). A standard chart of accounts is created: cash and bank, receivables, GST input and output, fee and other income, salaries and other expenses.</p>
            <Submit className={btnPrimary} pending="Setting up">Set up the books</Submit>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
