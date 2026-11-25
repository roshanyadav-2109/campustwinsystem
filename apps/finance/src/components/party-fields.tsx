import { inputCls, labelCls } from "@/components/ui";
import { STATES } from "@/lib/format";

type P = { kind?: string; name?: string; gstin?: string | null; state_code?: string | null; email?: string | null; phone?: string | null; address?: string | null };

export function PartyFields({ v = {} }: { v?: P }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="name" className={labelCls}>Name</label>
        <input id="name" name="name" required maxLength={160} defaultValue={v.name ?? ""} className={inputCls} />
      </div>
      <div>
        <label htmlFor="kind" className={labelCls}>Type</label>
        <select id="kind" name="kind" defaultValue={v.kind ?? "customer"} className={inputCls}>
          <option value="customer">Customer (pays you)</option>
          <option value="vendor">Vendor (you pay them)</option>
          <option value="both">Both</option>
        </select>
      </div>
      <div>
        <label htmlFor="state_code" className={labelCls}>State</label>
        <select id="state_code" name="state_code" defaultValue={v.state_code ?? ""} className={inputCls}>
          <option value="">Not stated</option>
          {STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="gstin" className={labelCls}>GSTIN</label>
        <input id="gstin" name="gstin" maxLength={15} defaultValue={v.gstin ?? ""} className={`${inputCls} uppercase`} />
      </div>
      <div>
        <label htmlFor="phone" className={labelCls}>Phone</label>
        <input id="phone" name="phone" type="tel" maxLength={20} defaultValue={v.phone ?? ""} className={inputCls} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="email" className={labelCls}>Email</label>
        <input id="email" name="email" type="email" defaultValue={v.email ?? ""} className={inputCls} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="address" className={labelCls}>Address</label>
        <textarea id="address" name="address" rows={2} maxLength={500} defaultValue={v.address ?? ""} className={inputCls} />
      </div>
    </div>
  );
}
