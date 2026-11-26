"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  grantConcession, previewLateRule, raiseInstalment, removeConcession, saveConcessionType, saveFeeHeadOptions, saveInstalments, saveLateRule,
} from "@/app/dashboard/fees/actions";
import { fmtDay, fmtMoney, type ConcessionType, type FeeHead, type Instalment, type LateRule, type StudentConcession } from "@/components/fees/shared";

const ERR = "text-[13px] text-down";
const OK = "text-[13px] font-medium text-up";
const TH = "pb-2 pr-3 text-left text-[12px] font-semibold text-muted";
type ClassOpt = { id: number; name: string };
type SectionOpt = { id: number; name: string; class_id: number };

// ---------------------------------------------------------------------------
// The year's instalment plan
// ---------------------------------------------------------------------------
type Row = { key: string; id?: number; name: string; dueDate: string; share: string; locked: boolean };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function addMonths(iso: string, n: number) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 10));
  return d.toISOString().slice(0, 10);
}
// Equal shares that add up to exactly 100.
function shares(n: number) {
  const each = Math.floor((100 / n) * 1000) / 1000;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? Math.round((100 - each * (n - 1)) * 1000) / 1000 : each));
}
const PRESETS: { label: string; build: (start: string) => { name: string; dueDate: string; share: number }[] }[] = [
  { label: "Once a year", build: (s) => [{ name: "Annual fees", dueDate: addMonths(s, 0), share: 100 }] },
  { label: "Two terms", build: (s) => shares(2).map((sh, i) => ({ name: `Term ${i + 1}`, dueDate: addMonths(s, i * 6), share: sh })) },
  { label: "Three terms", build: (s) => shares(3).map((sh, i) => ({ name: `Term ${i + 1}`, dueDate: addMonths(s, i * 4), share: sh })) },
  { label: "Quarterly", build: (s) => shares(4).map((sh, i) => ({ name: `Quarter ${i + 1}`, dueDate: addMonths(s, i * 3), share: sh })) },
  { label: "Monthly", build: (s) => shares(12).map((sh, i) => { const d = addMonths(s, i); return { name: `${MONTHS[Number(d.slice(5, 7)) - 1]} fees`, dueDate: d, share: sh }; }) },
];

export function InstalmentPlanner({ instalments, yearStart, yearName }: { instalments: Instalment[]; yearStart: string; yearName: string }) {
  const initial = (): Row[] => instalments.map((i) => ({ key: `i${i.id}`, id: i.id, name: i.name, dueDate: i.due_date, share: String(i.share_pct), locked: i.raised > 0 }));
  const [rows, setRows] = useState<Row[]>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const locked = rows.filter((r) => r.locked);
  const total = Math.round(rows.reduce((n, r) => n + (Number(r.share) || 0), 0) * 1000) / 1000;
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const usePreset = (p: (typeof PRESETS)[number]) => {
    if (locked.length) return;
    setRows(p.build(yearStart).map((r, i) => ({ key: `n${Date.now()}${i}`, name: r.name, dueDate: r.dueDate, share: String(r.share), locked: false })));
    setMsg(null);
  };
  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await saveInstalments(rows.map((r) => ({ id: r.id, name: r.name, dueDate: r.dueDate, sharePct: Number(r.share) })));
      setMsg(res.ok ? { ok: true, text: "Instalments saved." } : { ok: false, text: res.error });
    });
  };
  return (
    <Card>
      <CardHeader eyebrow="Instalments" title={`How the year's fees are collected, ${yearName}`} />
      <CardBody className="space-y-4">
        {!locked.length && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-700">Start from</span>
            {PRESETS.map((p) => <Button key={p.label} size="sm" variant="subtle" onClick={() => usePreset(p)}>{p.label}</Button>)}
          </div>
        )}
        {rows.length === 0 ? <p className="text-[13px] text-ink-500">No instalments yet. Choose one of the starting points above.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead><tr><th className={TH}>Name</th><th className={TH}>Due date</th><th className={TH}>Share of the year</th><th className={TH} /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-hair">
                    <td className="py-1.5 pr-3">{r.locked ? <span className="text-ink-900">{r.name}</span> : <Input className="h-8" aria-label="Instalment name" maxLength={60} value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} />}</td>
                    <td className="py-1.5 pr-3">{r.locked ? <span className="tabular">{fmtDay(r.dueDate)}</span> : <Input className="h-8 w-40" type="date" aria-label={`Due date of ${r.name}`} value={r.dueDate} onChange={(e) => set(r.key, { dueDate: e.target.value })} />}</td>
                    <td className="py-1.5 pr-3">{r.locked ? <span className="tabular">{r.share}%</span> : (
                      <span className="flex items-center gap-1"><Input className="h-8 w-24" inputMode="decimal" aria-label={`Share of ${r.name}`} value={r.share} onChange={(e) => set(r.key, { share: e.target.value })} />%</span>
                    )}</td>
                    <td className="py-1.5 text-right">{r.locked
                      ? <span className="text-[12px] text-ink-500">Raised</span>
                      : <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { key: `n${Date.now()}`, name: "", dueDate: addMonths(rs[rs.length - 1]?.dueDate ?? yearStart, rs.length ? 1 : 0), share: "", locked: false }])}>Add an instalment</Button>
          <span className={`text-[13px] tabular ${Math.abs(total - 100) < 0.001 ? "text-ink-700" : "text-down"}`}>Total {total}%</span>
          <span className="flex-1" />
          <Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save instalments"}</Button>
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? OK : ERR}>{msg.text}</p>}
        <p className="text-[12px] text-muted">Each head is split by these shares, and the last instalment takes any paise left over, so the year always adds up to the annual fee. A head charged once a year goes in full on the first instalment. Instalments that have been raised cannot be changed.</p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// How each head is charged
// ---------------------------------------------------------------------------
export function HeadOptions({ heads }: { heads: FeeHead[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (h: FeeHead, patch: Partial<FeeHead>) => {
    setError(null);
    start(async () => {
      const res = await saveFeeHeadOptions({ id: h.id, charge: patch.charge ?? h.charge, isTuition: patch.is_tuition ?? h.is_tuition });
      if (!res.ok) setError(res.error);
    });
  };
  if (!heads.length) return null;
  return (
    <Card>
      <CardHeader title="How each head is charged" />
      <CardBody className="space-y-2">
        <ul>
          {heads.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 border-b border-hair py-2 last:border-0">
              <span className="min-w-32 flex-1 text-[14px] text-ink-900">{h.name}</span>
              <Select className="h-8 w-60" aria-label={`How ${h.name} is charged`} disabled={pending} value={h.charge} onChange={(e) => save(h, { charge: e.target.value as FeeHead["charge"] })}>
                <option value="split">Split across the instalments</option>
                <option value="once">Once a year, on the first instalment</option>
              </Select>
              <label className="flex items-center gap-1.5 text-[13px] text-ink-700">
                <input type="checkbox" disabled={pending} checked={h.is_tuition} onChange={(e) => save(h, { is_tuition: e.target.checked })} /> Tuition fee
              </label>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className={ERR}>{error}</p>}
        <p className="text-[12px] text-muted">Tuition fees are listed separately on the yearly fee certificate parents use for income tax.</p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Concession types
// ---------------------------------------------------------------------------
type Draft = { id?: number; name: string; kind: "percent" | "amount"; value: string; heads: number[]; sibling: boolean; active: boolean };
const blank: Draft = { name: "", kind: "percent", value: "", heads: [], sibling: false, active: true };

export function ConcessionTypesManager({ types, heads }: { types: ConcessionType[]; heads: FeeHead[] }) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const headName = new Map(heads.map((h) => [h.id, h.name]));
  const save = () => {
    if (!draft) return;
    setError(null);
    start(async () => {
      const res = await saveConcessionType({ id: draft.id, name: draft.name, kind: draft.kind, value: Number(draft.value), headIds: draft.heads.length ? draft.heads : null, sibling: draft.sibling, active: draft.active });
      if (res.ok) setDraft(null); else setError(res.error);
    });
  };
  return (
    <Card>
      <CardHeader title="Concessions" action={!draft && <Button size="sm" variant="subtle" onClick={() => setDraft({ ...blank })}>Add a concession</Button>} />
      <CardBody className="space-y-3">
        {types.length === 0 && !draft && <p className="text-[13px] text-ink-500">None yet. Add the ones the school gives, for example a sibling discount, a staff child concession or an RTE seat.</p>}
        <ul>
          {types.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hair py-2 last:border-0">
              <div className="min-w-0">
                <div className={`text-[14px] ${t.active ? "text-ink-900" : "text-muted line-through"}`}>{t.name}</div>
                <div className="text-[12px] text-ink-500">
                  {t.kind === "percent" ? `${t.value}% off` : `${fmtMoney(t.value)} off a year`}
                  {t.head_ids?.length ? ` · on ${t.head_ids.map((id) => headName.get(id) ?? "").filter(Boolean).join(", ")}` : " · on all heads"}
                  {t.auto_rule === "sibling" ? " · given automatically to the second child onwards" : ""}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDraft({ id: t.id, name: t.name, kind: t.kind, value: String(t.value), heads: t.head_ids ?? [], sibling: t.auto_rule === "sibling", active: t.active })}>Edit</Button>
            </li>
          ))}
        </ul>
        {draft && (
          <div className="space-y-3 rounded-sm border border-hair p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_150px_130px]">
              <Field label="Name" htmlFor={`${uid}-f1`}><Input id={`${uid}-f1`} value={draft.name} maxLength={60} placeholder="For example, Sibling discount" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Type" htmlFor={`${uid}-f2`}>
                <Select id={`${uid}-f2`} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft["kind"] })}>
                  <option value="percent">Percentage off</option>
                  <option value="amount">Amount off a year</option>
                </Select>
              </Field>
              <Field label={draft.kind === "percent" ? "Percent" : "Rupees a year"} htmlFor={`${uid}-f3`}><Input id={`${uid}-f3`} inputMode="decimal" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></Field>
            </div>
            <fieldset>
              <legend className="mb-1 text-[13px] font-medium text-ink-700">Applies to</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={draft.heads.length === 0} onChange={() => setDraft({ ...draft, heads: [] })} /> All heads</label>
                {heads.filter((h) => h.is_active).map((h) => (
                  <label key={h.id} className="flex items-center gap-1.5 text-[13px]">
                    <input type="checkbox" checked={draft.heads.includes(h.id)} onChange={(e) => setDraft({ ...draft, heads: e.target.checked ? [...draft.heads, h.id] : draft.heads.filter((x) => x !== h.id) })} /> {h.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={draft.sibling} onChange={(e) => setDraft({ ...draft, sibling: e.target.checked })} /> Give automatically to the second child onwards in a family (younger children, by date of birth)</label>
            {draft.id && <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> In use</label>}
            <div className="flex gap-2">
              <Button disabled={pending || !draft.name.trim() || !draft.value} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
              <Button variant="ghost" disabled={pending} onClick={() => { setDraft(null); setError(null); }}>Cancel</Button>
            </div>
          </div>
        )}
        {error && <p role="alert" className={ERR}>{error}</p>}
        <p className="text-[12px] text-muted">Concessions are taken off when an instalment is raised. Invoices already raised are not changed.</p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Raise an instalment
// ---------------------------------------------------------------------------
export function InstalmentRaise({ instalments, classes, sections, enrolled }: { instalments: Instalment[]; classes: ClassOpt[]; sections: SectionOpt[]; enrolled: number }) {
  const uid = useId();
  const next = instalments.find((i) => i.raised < enrolled) ?? instalments[0];
  const [insId, setInsId] = useState<number | "">(next?.id ?? "");
  const [classId, setClassId] = useState<number | "">("");
  const [sectionId, setSectionId] = useState<number | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!instalments.length) return (
    <Card><CardBody><p className="text-[14px] text-ink-700">Set up the year&apos;s instalments in <a className="font-medium text-[#0F6CBD] hover:underline" href="/dashboard/fees?view=setup">Fee setup</a> first. Then each instalment is raised for the whole school in one step, with concessions already taken off.</p></CardBody></Card>
  );
  const ins = instalments.find((i) => i.id === insId);
  const raise = () => {
    if (!insId) return;
    setMsg(null);
    start(async () => {
      const res = await raiseInstalment({ instalmentId: insId, classId: sectionId ? null : classId || null, sectionId: sectionId || null });
      setMsg(res.ok
        ? { ok: true, text: res.created ? `${res.created} ${res.created === 1 ? "invoice" : "invoices"} raised.` : "Everyone there already has this instalment." }
        : { ok: false, text: res.error });
    });
  };
  return (
    <Card>
      <CardHeader eyebrow="Raise an instalment" title={ins ? `${ins.name}, due ${fmtDay(ins.due_date)}` : "Choose an instalment"} />
      <CardBody className="space-y-4">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {instalments.map((i) => (
            <li key={i.id} className="rounded-sm border border-hair px-3 py-2">
              <div className="flex items-baseline justify-between gap-2"><span className="text-[14px] font-medium text-ink-900">{i.name}</span><span className="text-[12px] tabular text-ink-500">{i.share_pct}%</span></div>
              <div className="text-[12px] text-ink-500">Due {fmtDay(i.due_date)} · {i.raised ? `raised for ${i.raised} of ${enrolled} students` : "not raised yet"}</div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48"><Field label="Instalment" htmlFor={`${uid}-f4`}>
            <Select id={`${uid}-f4`} value={insId} onChange={(e) => setInsId(Number(e.target.value) || "")}>{instalments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>
          </Field></div>
          <div className="w-40"><Field label="Class" htmlFor={`${uid}-f5`}>
            <Select id={`${uid}-f5`} value={classId} onChange={(e) => { setClassId(Number(e.target.value) || ""); setSectionId(""); }}>
              <option value="">Whole school</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field></div>
          {classId !== "" && <div className="w-40"><Field label="Section" htmlFor={`${uid}-f6`}>
            <Select id={`${uid}-f6`} value={sectionId} onChange={(e) => setSectionId(Number(e.target.value) || "")}>
              <option value="">All sections</option>{sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field></div>}
          <Button disabled={pending || !insId} onClick={raise}>{pending ? "Raising…" : "Raise"}</Button>
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? OK : ERR}>{msg.text}</p>}
        <p className="text-[12px] text-muted">Students who already have this instalment are skipped, so it is safe to raise again after new admissions.</p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// A student's concessions (Collect)
// ---------------------------------------------------------------------------
export function StudentConcessions({ studentId, granted, types }: { studentId: number; granted: StudentConcession[]; types: ConcessionType[] }) {
  const uid = useId();
  const available = types.filter((t) => t.active && !granted.some((g) => g.typeId === t.id));
  const [typeId, setTypeId] = useState<number | "">(available[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => {
    setError(null);
    start(async () => { const res = await fn(); if (res.ok) after?.(); else setError(res.error); });
  };
  if (!types.length && !granted.length) return null;
  return (
    <Card>
      <CardHeader title="Concessions this year" />
      <CardBody className="space-y-3">
        {granted.length === 0 ? <p className="text-[13px] text-ink-500">None.</p> : (
          <ul>{granted.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hair py-2 last:border-0">
              <div><div className="text-[14px] text-ink-900">{g.name} <span className="text-ink-500">· {g.detail}</span></div>
                {(g.isAuto || g.note) && <div className="text-[12px] text-ink-500">{g.isAuto ? "Given automatically as a younger sibling" : g.note}</div>}</div>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeConcession(g.id))}>Remove</Button>
            </li>
          ))}</ul>
        )}
        {available.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56"><Field label="Give a concession" htmlFor={`${uid}-f7`}>
              <Select id={`${uid}-f7`} value={typeId} onChange={(e) => setTypeId(Number(e.target.value) || "")}>{available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            </Field></div>
            <div className="min-w-0 flex-1"><Field label="Reason (optional)" htmlFor={`${uid}-f8`}><Input id={`${uid}-f8`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field></div>
            <Button disabled={pending || !typeId} onClick={() => typeId && run(() => grantConcession({ studentId, typeId, note }), () => setNote(""))}>Give</Button>
          </div>
        )}
        {error && <p role="alert" className={ERR}>{error}</p>}
        <p className="text-[12px] text-muted">Applies to instalments raised from now on.</p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Late fee rule
// ---------------------------------------------------------------------------
export function LateFeeCard({ rule }: { rule: LateRule | null }) {
  const uid = useId();
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [kind, setKind] = useState<LateRule["kind"]>(rule?.kind ?? "per_week");
  const [amount, setAmount] = useState(rule ? String(rule.amount) : "");
  const [max, setMax] = useState(rule?.max_amount != null ? String(rule.max_amount) : "");
  const [grace, setGrace] = useState(String(rule?.grace_days ?? 0));
  const [includeOld, setIncludeOld] = useState(!!rule && rule.applies_from === null);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const input = () => ({ enabled, kind, amount: Number(amount), maxAmount: max.trim() ? Number(max) : null, graceDays: Number(grace), includeOld });
  const touch = () => setPreview(null);
  const check = () => {
    setMsg(null); setPreview(null);
    start(async () => {
      const res = await previewLateRule(input());
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      setPreview(res.invoices ? `This would add late fees to ${res.invoices} ${res.invoices === 1 ? "bill" : "bills"} today, ${fmtMoney(res.extra)} in all.` : "This would not add a late fee to any bill today.");
    });
  };
  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await saveLateRule(input());
      setMsg(res.ok
        ? { ok: true, text: enabled ? `Saved. Late fees were added to ${res.applied} ${res.applied === 1 ? "bill" : "bills"} now, and are kept up to date every night.` : "Saved. Late fees are switched off." }
        : { ok: false, text: res.error });
    });
  };
  const unit = kind === "once" ? "once" : kind === "per_week" ? "for every week late" : "for every month late";
  const g = Number(grace) || 0;
  return (
    <Card>
      <CardHeader title="Late fee" />
      <CardBody className="space-y-3">
        <label className="flex items-center gap-2 text-[14px] font-medium text-ink-900">
          <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); touch(); }} /> Charge a late fee on bills paid after their due date
        </label>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="How" htmlFor={`${uid}-k`}>
            <Select id={`${uid}-k`} value={kind} onChange={(e) => { setKind(e.target.value as LateRule["kind"]); touch(); }}>
              <option value="per_week">Every week late</option>
              <option value="per_month">Every month late</option>
              <option value="once">Once</option>
            </Select>
          </Field>
          <Field label="Amount (₹)" htmlFor={`${uid}-a`}><Input id={`${uid}-a`} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); touch(); }} /></Field>
          <Field label="At most (₹, optional)" htmlFor={`${uid}-m`}><Input id={`${uid}-m`} inputMode="decimal" value={max} onChange={(e) => { setMax(e.target.value); touch(); }} /></Field>
          <Field label="Days of grace" htmlFor={`${uid}-g`}><Input id={`${uid}-g`} inputMode="numeric" value={grace} onChange={(e) => { setGrace(e.target.value); touch(); }} /></Field>
        </div>
        {amount && <p className="text-[13px] text-ink-700">{fmtMoney(Number(amount) || 0)} {unit}{max ? `, up to ${fmtMoney(Number(max) || 0)} on a bill` : ""}, starting {g} {g === 1 ? "day" : "days"} after the due date.</p>}
        <label className="flex items-center gap-2 text-[13px] text-ink-700">
          <input type="checkbox" checked={includeOld} onChange={(e) => { setIncludeOld(e.target.checked); touch(); }} /> Also charge bills that were already overdue before late fees were switched on
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="subtle" disabled={pending || !amount} onClick={check}>See what this adds</Button>
          <Button disabled={pending || (enabled && !amount)} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
        </div>
        {preview && <p role="status" className="text-[13px] font-medium text-ink-900">{preview}</p>}
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? OK : ERR}>{msg.text}</p>}
        <p className="text-[12px] text-muted">The office can waive a late fee on any bill, with a reason. A waived late fee is never added back.</p>
      </CardBody>
    </Card>
  );
}
