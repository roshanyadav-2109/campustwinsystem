"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { saveScheme, deleteScheme, setAssignment, type SchemeInput } from "@/app/dashboard/settings/report-cards/actions";

export type SchemeView = SchemeInput & { id: number };
export type Option = { id: number; name: string };
export type ClassOpt = { id: number; name: string; schemeId: number | null; sections: { id: number; name: string; schemeId: number | null }[] };

const RULES = [
  { value: "sum", label: "Add the tests together" },
  { value: "average", label: "Average of the tests" },
  { value: "best", label: "Best of the tests" },
] as const;
const MODES = [
  { value: "counted", label: "In the total" },
  { value: "not_counted", label: "Shown, not in the total" },
  { value: "hidden", label: "Not on the card" },
] as const;

const blank = (): SchemeInput => ({
  id: null, name: "", board: "", pass_percent: "", overall_pass_percent: "", show_marks: true, show_grades: true, show_percent: true,
  final_label: "Final result", terms: [{ term: 1, name: "Term 1", starts_on: "", ends_on: "" }], components: [], bands: [], areas: [], subjects: [],
});

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}
const TH = "px-2 py-1.5 text-left text-[12px] font-medium text-ink-500";
const TD = "px-2 py-1 align-top";
const small = "h-8 text-[13px]";

function Editor({ initial, examTypes, subjects, onDone }: { initial: SchemeInput; examTypes: Option[]; subjects: Option[]; onDone: () => void }) {
  const uid = useId();
  const [s, setS] = useState<SchemeInput>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof SchemeInput>(k: K, v: SchemeInput[K]) => setS((x) => ({ ...x, [k]: v }));
  const upd = <K extends "terms" | "components" | "bands" | "areas">(k: K, i: number, patch: Partial<SchemeInput[K][number]>) =>
    setS((x) => ({ ...x, [k]: (x[k] as unknown[]).map((r, j) => (j === i ? { ...(r as object), ...patch } : r)) }));
  const del = (k: "terms" | "components" | "bands" | "areas", i: number) => setS((x) => ({ ...x, [k]: (x[k] as unknown[]).filter((_, j) => j !== i) }));
  const subjMode = (id: number) => s.subjects.find((x) => x.subject_id === id)?.mode ?? "counted";
  const subjSort = (id: number) => s.subjects.find((x) => x.subject_id === id)?.sort ?? 0;
  const setSubj = (id: number, patch: Partial<{ mode: "counted" | "not_counted" | "hidden"; sort: number }>) =>
    setS((x) => {
      const cur = x.subjects.find((y) => y.subject_id === id) ?? { subject_id: id, mode: "counted" as const, sort: 0 };
      return { ...x, subjects: [...x.subjects.filter((y) => y.subject_id !== id), { ...cur, ...patch }] };
    });

  return (
    <Card>
      <CardHeader title={s.id ? `Edit: ${initial.name}` : "New scheme"} action={<Button size="sm" variant="ghost" onClick={onDone}>Close</Button>} />
      <CardBody className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Scheme name" htmlFor={`${uid}-n`} hint="For example: CBSE Classes VI-VIII, State board, Cambridge."><Input id={`${uid}-n`} value={s.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Board (optional)" htmlFor={`${uid}-b`}><Input id={`${uid}-b`} value={s.board} onChange={(e) => set("board", e.target.value)} /></Field>
          <Field label="Name of the year-end result" htmlFor={`${uid}-f`}><Input id={`${uid}-f`} value={s.final_label} onChange={(e) => set("final_label", e.target.value)} /></Field>
          <Field label="Pass mark per subject, % (optional)" htmlFor={`${uid}-p`}><Input id={`${uid}-p`} inputMode="decimal" value={s.pass_percent} onChange={(e) => set("pass_percent", e.target.value)} /></Field>
          <Field label="Pass mark overall, % (optional)" htmlFor={`${uid}-o`}><Input id={`${uid}-o`} inputMode="decimal" value={s.overall_pass_percent} onChange={(e) => set("overall_pass_percent", e.target.value)} /></Field>
          <div className="flex flex-wrap items-end gap-4 pb-2 text-[13px]">
            {(["show_marks", "show_grades", "show_percent"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={s[k]} onChange={(e) => set(k, e.target.checked)} className="h-4 w-4 accent-[#0F6CBD]" />
                {k === "show_marks" ? "Show marks" : k === "show_grades" ? "Show grades" : "Show percent"}
              </label>
            ))}
          </div>
        </div>

        <section>
          <h4 className="mb-1 text-[13px] font-semibold text-ink-900">Terms</h4>
          <p className="mb-2 text-[12px] text-ink-500">The number matches the term chosen when an exam is created. Dates are optional; with them, attendance is counted for the term.</p>
          <table className="w-full"><thead><tr><th className={TH}>No.</th><th className={TH}>Name</th><th className={TH}>First day</th><th className={TH}>Last day</th><th /></tr></thead>
            <tbody>{s.terms.map((t, i) => (
              <tr key={i}>
                <td className={TD}><Input className={`${small} w-16`} aria-label={`Term ${i + 1} number`} inputMode="numeric" value={t.term} onChange={(e) => upd("terms", i, { term: Number(e.target.value) || 0 })} /></td>
                <td className={TD}><Input className={small} aria-label={`Term ${i + 1} name`} value={t.name} onChange={(e) => upd("terms", i, { name: e.target.value })} /></td>
                <td className={TD}><Input className={small} type="date" aria-label={`Term ${i + 1} first day`} value={t.starts_on} onChange={(e) => upd("terms", i, { starts_on: e.target.value })} /></td>
                <td className={TD}><Input className={small} type="date" aria-label={`Term ${i + 1} last day`} value={t.ends_on} onChange={(e) => upd("terms", i, { ends_on: e.target.value })} /></td>
                <td className={TD}><Button size="sm" variant="ghost" onClick={() => del("terms", i)}>Remove</Button></td>
              </tr>))}
            </tbody></table>
          <Button size="sm" variant="subtle" onClick={() => set("terms", [...s.terms, { term: (Math.max(0, ...s.terms.map((t) => t.term)) + 1), name: `Term ${s.terms.length + 1}`, starts_on: "", ends_on: "" }])}>Add a term</Button>
        </section>

        <section>
          <h4 className="mb-1 text-[13px] font-semibold text-ink-900">What counts</h4>
          <p className="mb-2 text-[12px] text-ink-500">Each part takes the exams of one type in a term, combines them, and scales the result. Limit a part to some subjects for things like practicals.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[860px]"><thead><tr>
            <th className={TH}>Term</th><th className={TH}>Part name</th><th className={TH}>Exam type</th><th className={TH}>How tests combine</th><th className={TH}>Best</th><th className={TH}>Out of</th><th className={TH}>Subjects</th><th /></tr></thead>
            <tbody>{s.components.map((c, i) => (
              <tr key={i}>
                <td className={TD}><Select className={`${small} w-20`} aria-label={`Part ${i + 1} term`} value={c.term} onChange={(e) => upd("components", i, { term: Number(e.target.value) })}>
                  {s.terms.map((t) => <option key={t.term} value={t.term}>{t.name}</option>)}</Select></td>
                <td className={TD}><Input className={small} aria-label={`Part ${i + 1} name`} value={c.name} onChange={(e) => upd("components", i, { name: e.target.value })} /></td>
                <td className={TD}><Select className={small} aria-label={`Part ${i + 1} exam type`} value={c.assessment_type_id || ""} onChange={(e) => upd("components", i, { assessment_type_id: Number(e.target.value) })}>
                  <option value="">Choose</option>{examTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></td>
                <td className={TD}><Select className={small} aria-label={`Part ${i + 1} rule`} value={c.rule} onChange={(e) => upd("components", i, { rule: e.target.value as "sum" | "average" | "best" })}>
                  {RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></td>
                <td className={TD}><Input className={`${small} w-14`} aria-label={`Part ${i + 1} best how many`} disabled={c.rule !== "best"} inputMode="numeric" value={c.best_n} onChange={(e) => upd("components", i, { best_n: e.target.value })} /></td>
                <td className={TD}><Input className={`${small} w-20`} aria-label={`Part ${i + 1} out of`} inputMode="decimal" value={c.out_of} onChange={(e) => upd("components", i, { out_of: e.target.value })} /></td>
                <td className={TD}>
                  <details className="text-[12px]"><summary className="cursor-pointer text-ink-700">{c.subject_ids.length ? `${c.subject_ids.length} subjects` : "All subjects"}</summary>
                    <div className="mt-1 max-h-40 space-y-0.5 overflow-auto rounded-sm border border-hair bg-white p-2">
                      {subjects.map((sb) => (
                        <label key={sb.id} className="flex items-center gap-1.5">
                          <input type="checkbox" checked={c.subject_ids.includes(sb.id)} className="h-3.5 w-3.5 accent-[#0F6CBD]"
                            onChange={(e) => upd("components", i, { subject_ids: e.target.checked ? [...c.subject_ids, sb.id] : c.subject_ids.filter((x) => x !== sb.id) })} />{sb.name}
                        </label>))}
                    </div></details>
                </td>
                <td className={TD}><Button size="sm" variant="ghost" onClick={() => del("components", i)}>Remove</Button></td>
              </tr>))}
            </tbody></table></div>
          <Button size="sm" variant="subtle" onClick={() => set("components", [...s.components, { id: null, term: s.terms[0]?.term ?? 1, name: "", assessment_type_id: 0, rule: "sum", best_n: "", out_of: "100", sort: s.components.length, subject_ids: [] }])}>Add a part</Button>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <h4 className="mb-1 text-[13px] font-semibold text-ink-900">Grades</h4>
            <p className="mb-2 text-[12px] text-ink-500">A grade is given from its lowest percent up to the next grade.</p>
            <table className="w-full"><thead><tr><th className={TH}>From %</th><th className={TH}>Grade</th><th className={TH}>Grade point</th><th className={TH}>Remark</th><th /></tr></thead>
              <tbody>{s.bands.map((b, i) => (
                <tr key={i}>
                  <td className={TD}><Input className={`${small} w-20`} aria-label={`Grade ${i + 1} from percent`} inputMode="decimal" value={b.min_percent} onChange={(e) => upd("bands", i, { min_percent: e.target.value })} /></td>
                  <td className={TD}><Input className={`${small} w-16`} aria-label={`Grade ${i + 1}`} value={b.grade} onChange={(e) => upd("bands", i, { grade: e.target.value })} /></td>
                  <td className={TD}><Input className={`${small} w-16`} aria-label={`Grade ${i + 1} point`} inputMode="decimal" value={b.grade_point} onChange={(e) => upd("bands", i, { grade_point: e.target.value })} /></td>
                  <td className={TD}><Input className={small} aria-label={`Grade ${i + 1} remark`} value={b.remark} onChange={(e) => upd("bands", i, { remark: e.target.value })} /></td>
                  <td className={TD}><Button size="sm" variant="ghost" onClick={() => del("bands", i)}>Remove</Button></td>
                </tr>))}
              </tbody></table>
            <Button size="sm" variant="subtle" onClick={() => set("bands", [...s.bands, { min_percent: "", grade: "", grade_point: "", remark: "" }])}>Add a grade</Button>
          </section>
          <section>
            <h4 className="mb-1 text-[13px] font-semibold text-ink-900">Co-scholastic areas</h4>
            <p className="mb-2 text-[12px] text-ink-500">Graded by the class teacher each term (art, sports, discipline...). Removing an area removes the grades given in it.</p>
            <table className="w-full"><thead><tr><th className={TH}>Area</th><th className={TH}>Grades allowed</th><th /></tr></thead>
              <tbody>{s.areas.map((a, i) => (
                <tr key={i}>
                  <td className={TD}><Input className={small} aria-label={`Area ${i + 1} name`} value={a.name} onChange={(e) => upd("areas", i, { name: e.target.value })} /></td>
                  <td className={TD}><Input className={small} aria-label={`Area ${i + 1} grades`} value={a.grades.join(", ")} placeholder="A, B, C" onChange={(e) => upd("areas", i, { grades: e.target.value.split(",") })} /></td>
                  <td className={TD}><Button size="sm" variant="ghost" onClick={() => del("areas", i)}>Remove</Button></td>
                </tr>))}
              </tbody></table>
            <Button size="sm" variant="subtle" onClick={() => set("areas", [...s.areas, { id: null, name: "", grades: ["A", "B", "C"], sort: s.areas.length }])}>Add an area</Button>
          </section>
        </div>

        <section>
          <h4 className="mb-1 text-[13px] font-semibold text-ink-900">Subjects</h4>
          <p className="mb-2 text-[12px] text-ink-500">Order on the card, and whether a subject counts in the total (a grade-only subject can be shown without counting).</p>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {subjects.map((sb) => (
              <div key={sb.id} className="flex items-center gap-2 text-[13px]">
                <Input className={`${small} w-14`} aria-label={`${sb.name} order`} inputMode="numeric" value={subjSort(sb.id)} onChange={(e) => setSubj(sb.id, { sort: Number(e.target.value) || 0 })} />
                <span className="min-w-0 flex-1 truncate">{sb.name}</span>
                <Select className={`${small} w-44`} aria-label={`${sb.name} on the card`} value={subjMode(sb.id)} onChange={(e) => setSubj(sb.id, { mode: e.target.value as "counted" | "not_counted" | "hidden" })}>
                  {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select>
              </div>))}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-hair pt-3">
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await saveScheme(s);
            setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
            if (r.ok) { if (r.id) set("id", r.id); router.refresh(); }
          })}>{pending ? "Saving…" : "Save scheme"}</Button>
          <Msg m={msg} />
        </div>
      </CardBody>
    </Card>
  );
}

export function ReportSchemesAdmin({ schemes, examTypes, subjects, classes }: { schemes: SchemeView[]; examTypes: Option[]; subjects: Option[]; classes: ClassOpt[] }) {
  const [editing, setEditing] = useState<SchemeInput | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const assign = (classId: number, sectionId: number | null, schemeId: number | null) => start(async () => {
    const r = await setAssignment({ classId, sectionId, schemeId });
    setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
    router.refresh();
  });
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Schemes" action={<Button size="sm" onClick={() => setEditing(blank())}>New scheme</Button>} />
        <CardBody className="p-0">
          {schemes.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-500">No schemes yet. Create one for each board or pattern your school follows.</p>
          ) : (
            <ul>{schemes.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink-900">{s.name}{s.board && <span className="ml-2 text-[12px] font-normal text-ink-500">{s.board}</span>}</p>
                  <p className="text-[12px] text-ink-500">{s.terms.map((t) => t.name).join(", ")} · {s.components.length} parts · {s.bands.length} grades · {s.areas.length} co-scholastic areas</p>
                </div>
                <Button size="sm" variant="subtle" onClick={() => setEditing(s)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ ...s, id: null, name: `${s.name} (copy)`, components: s.components.map((c) => ({ ...c, id: null })), areas: s.areas.map((a) => ({ ...a, id: null })) })}>Copy</Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await deleteScheme(s.id); setMsg(r.ok ? { ok: true, text: "Deleted." } : { ok: false, text: r.error }); router.refresh(); })}>Delete</Button>
              </li>))}
            </ul>
          )}
        </CardBody>
      </Card>
      {editing && <Editor key={editing.id ?? "new"} initial={editing} examTypes={examTypes} subjects={subjects} onDone={() => setEditing(null)} />}
      <Card>
        <CardHeader title="Which class uses which scheme" action={<Msg m={msg} />} />
        <CardBody className="p-0">
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafafa]"><tr><th className="px-4 py-2 text-left font-medium text-ink-500">Class</th><th className="px-4 py-2 text-left font-medium text-ink-500">Scheme</th><th className="px-4 py-2 text-left font-medium text-ink-500">Sections using a different scheme</th></tr></thead>
            <tbody>{classes.map((c) => (
              <tr key={c.id} className="border-t border-hair align-top">
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2">
                  <Select className="h-8 text-[13px]" aria-label={`Scheme for class ${c.name}`} value={c.schemeId ?? ""} disabled={pending} onChange={(e) => assign(c.id, null, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">None yet</option>{schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-2">{c.sections.map((sec) => (
                    <label key={sec.id} className="flex items-center gap-1">
                      <span className="text-ink-700">{c.name}-{sec.name}</span>
                      <Select className="h-8 text-[12px]" aria-label={`Scheme for section ${c.name}-${sec.name}`} value={sec.schemeId ?? ""} disabled={pending} onChange={(e) => assign(c.id, sec.id, e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Same as class</option>{schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                    </label>))}
                  </div>
                </td>
              </tr>))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
