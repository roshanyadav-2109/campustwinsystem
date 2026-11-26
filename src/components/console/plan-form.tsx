"use client";
import { useActionState } from "react";
import { savePlan, type PlanResult } from "@/app/console/actions";
import { inputCls, labelCls, btnPrimary } from "./ui";

export const PLAN_MODULES: { key: string; label: string }[] = [
  { key: "fees", label: "Fees" },
  { key: "library", label: "Library" },
  { key: "homework", label: "Homework" },
  { key: "admissions", label: "Admissions" },
  { key: "hr", label: "HR and payroll" },
  { key: "transport", label: "Transport" },
];

export type PlanRow = { id: string; code: string; name: string; priceRupees: number; modules: Record<string, boolean>; active: boolean; schools: number };

// One plan: its name, price per student per year, and the modules it includes.
// Saving an existing plan updates every institution on it straight away.
export function PlanForm({ plan }: { plan?: PlanRow }) {
  const [state, action, pending] = useActionState<PlanResult, FormData>(savePlan, null);
  const p = plan;
  return (
    <form action={action} className="space-y-3">
      {p && <input type="hidden" name="planId" value={p.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div><label className={labelCls} htmlFor={`pn-${p?.id ?? "new"}`}>Plan name</label><input id={`pn-${p?.id ?? "new"}`} name="name" defaultValue={p?.name ?? ""} required className={inputCls} placeholder="Premium" /></div>
        <div><label className={labelCls} htmlFor={`pp-${p?.id ?? "new"}`}>Price per student a year (₹)</label><input id={`pp-${p?.id ?? "new"}`} name="price" type="number" min={0} step="1" defaultValue={p ? p.priceRupees : 0} className={inputCls} /></div>
      </div>
      <fieldset>
        <legend className={labelCls}>Included modules</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
          {PLAN_MODULES.map((m) => (
            <label key={m.key} className="flex items-center gap-2 text-[13px] text-cx-text">
              <input type="checkbox" name={`m_${m.key}`} defaultChecked={!!p?.modules[m.key]} /> {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      {p && (
        <label className="flex items-center gap-2 text-[13px] text-cx-text"><input type="checkbox" name="active" defaultChecked={p.active} /> Offered to new institutions</label>
      )}
      {state && <p role="status" className={`text-[13px] ${state.ok ? "text-cx-ok" : "text-cx-bad"}`}>{state.message}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-cx-muted">{p ? `${p.schools} institution${p.schools === 1 ? "" : "s"} on this plan` : "Core academics are always included: attendance, marks, timetable, reports."}</p>
        <button className={btnPrimary} disabled={pending}>{pending ? "Saving" : p ? "Save plan" : "Add plan"}</button>
      </div>
    </form>
  );
}
