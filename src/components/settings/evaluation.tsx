"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { createStandardScheme, saveScheme, assignScheme } from "@/app/dashboard/settings/evaluation/actions";

export type SchemeRow = { id: number; name: string; pass_percent: number; ese_min_percent: number | null;
  components: { id: number; part: string; name: string; rule: string; best_n: number | null; weight: number }[];
  grades: { min_percent: number; grade: string; point: number }[] };

function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) router.refresh();
  });
  return { msg, pending, run };
}
function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}
const RULE: Record<string, string> = { sum: "added together", average: "average of the tests", best: "best of the tests" };

function Scheme({ s, canEdit }: { s: SchemeRow; canEdit: boolean }) {
  const [pass, setPass] = useState(String(Number(s.pass_percent)));
  const [ese, setEse] = useState(s.ese_min_percent == null ? "" : String(Number(s.ese_min_percent)));
  const [w, setW] = useState<Record<number, string>>(Object.fromEntries(s.components.map((c) => [c.id, String(Number(c.weight))])));
  const { msg, pending, run } = useAct();
  const total = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0);
  return (
    <Card>
      <CardHeader title={s.name} action={<Msg m={msg} />} />
      <CardBody className="space-y-3">
        <table className="w-full text-[13px]"><tbody>{s.components.map((c) => (
          <tr key={c.id} className="border-t border-hair first:border-t-0">
            <td className="w-24 py-1.5 font-medium uppercase">{c.part}</td><td className="py-1.5">{c.name} <span className="text-ink-500">({RULE[c.rule]}{c.best_n ? ` ${c.best_n}` : ""})</span></td>
            <td className="w-32 py-1.5 text-right">{canEdit ? <Input className="h-8 w-20 text-right text-[13px]" aria-label={`${c.name} weight`} value={w[c.id]} onChange={(e) => setW({ ...w, [c.id]: e.target.value })} /> : Number(c.weight)}</td>
          </tr>))}</tbody></table>
        <p className="text-[12px] text-ink-500">Total {total} marks. A course is passed with at least {pass}% overall{ese ? ` and ${ese}% in the end-semester exam` : ""}.</p>
        {canEdit && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[12px] text-ink-700">Pass mark, % overall<Input className="mt-0.5 h-8 w-20 text-[13px]" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
            <label className="text-[12px] text-ink-700">Minimum in the end-semester exam, %<Input className="mt-0.5 h-8 w-20 text-[13px]" value={ese} onChange={(e) => setEse(e.target.value)} /></label>
            <Button size="sm" disabled={pending} onClick={() => run(() => saveScheme(s.id, { passPercent: pass, eseMin: ese, weights: w }))}>Save</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 border-t border-hair pt-2 text-[12px]">
          {s.grades.map((g) => <span key={g.grade} className="rounded-sm border border-hair px-2 py-0.5">{g.grade}: {Number(g.min_percent)}%+ = {Number(g.point)}</span>)}
        </div>
      </CardBody>
    </Card>
  );
}

export function EvaluationAdmin({ schemes, programmes, canEdit }: { schemes: SchemeRow[]; programmes: { id: number; code: string; name: string; eval_scheme_id: number | null }[]; canEdit: boolean }) {
  const { msg, pending, run } = useAct();
  return (
    <div className="space-y-4">
      {schemes.length === 0 && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-ink-700">No evaluation scheme yet. Start with the usual one: internal tests and a mid-semester exam (40), an end-semester exam (60), and UGC 10-point grades.</p>
            {canEdit && <Button disabled={pending} onClick={() => run(() => createStandardScheme())}>Create the standard scheme</Button>}
            <Msg m={msg} />
          </CardBody>
        </Card>
      )}
      {schemes.map((s) => <Scheme key={s.id} s={s} canEdit={canEdit} />)}
      {schemes.length > 0 && (
        <Card>
          <CardHeader title="Which programme uses which scheme" action={<Msg m={msg} />} />
          <CardBody className="p-0">
            <table className="w-full text-[13px]"><tbody>{programmes.map((p) => (
              <tr key={p.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5 font-medium">{p.name} <span className="text-ink-500">{p.code}</span></td>
                <td className="px-4 py-1.5">
                  <Select className="h-8 text-[13px]" aria-label={`Scheme for ${p.name}`} disabled={!canEdit || pending} value={p.eval_scheme_id ?? ""} onChange={(e) => run(() => assignScheme(p.id, e.target.value ? Number(e.target.value) : null))}>
                    <option value="">None</option>{schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                </td></tr>))}</tbody></table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
