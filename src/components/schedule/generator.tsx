"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { solveTimetable, type SolverResult } from "@/lib/timetable-solver";
import { saveLoads, copyLoads, saveUnavailable, saveRules, saveGenerated } from "@/app/dashboard/schedule/generate/actions";
import { DAYS, toggleCls } from "@/components/schedule/shared";

export type GenData = {
  yearId: number; yearName: string;
  periods: { no: number; label: string; isBreak: boolean; start: string }[];
  classes: { id: number; name: string; subjects: { id: number; name: string; code: string }[] }[];
  sections: { id: number; label: string; classId: number }[];
  teachers: { id: number; name: string }[];
  loads: { class_id: number; subject_id: number; periods: number; double_period: boolean; max_per_day: number | null }[];
  allotments: { section_id: number; subject_id: number; staff_id: number; is_class_teacher: boolean }[];
  unavailable: { staff_id: number; day_of_week: number; period_no: number }[];
  slots: { section_id: number; day_of_week: number; period_no: number; subject_id: number | null; staff_id: number | null }[];
  rules: { days: number[]; teacherMaxDay: number; classTeacherFirst: boolean };
};
type Tab = "loads" | "teachers" | "rules" | "make";
type Msg = { ok: boolean; text: string } | null;

function Note({ m }: { m: Msg }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}

export function TimetableGenerator({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("loads");
  const teaching = data.periods.filter((p) => !p.isBreak);
  const tabs: [Tab, string][] = [["loads", "Periods per week"], ["teachers", "Teacher availability"], ["rules", "Rules"], ["make", "Make the timetable"]];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{tabs.map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} className={`inline-flex h-9 items-center rounded-sm border px-3 text-[13px] font-medium ${toggleCls(tab === k)}`}>{l}</button>))}</div>
      {tab === "loads" && <Loads data={data} teaching={teaching.length} canEdit={canEdit} />}
      {tab === "teachers" && <Availability data={data} canEdit={canEdit} />}
      {tab === "rules" && <Rules data={data} canEdit={canEdit} />}
      {tab === "make" && <Make data={data} canEdit={canEdit} />}
    </div>
  );
}

function Loads({ data, teaching, canEdit }: { data: GenData; teaching: number; canEdit: boolean }) {
  const [classId, setClassId] = useState(data.classes[0]?.id ?? 0);
  const cls = data.classes.find((c) => c.id === classId);
  const init = () => Object.fromEntries((cls?.subjects ?? []).map((s) => {
    const l = data.loads.find((x) => x.class_id === classId && x.subject_id === s.id);
    return [s.id, { periods: l ? String(l.periods) : "", double: !!l?.double_period, max: l?.max_per_day ? String(l.max_per_day) : "" }];
  }));
  const [rows, setRows] = useState<Record<number, { periods: string; double: boolean; max: string }>>(init);
  const [copyTo, setCopyTo] = useState<number[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const capacity = data.rules.days.length * teaching;
  const total = Object.values(rows).reduce((a, r) => a + (Number(r.periods) || 0), 0);
  const pick = (id: number) => { setClassId(id); setMsg(null); setCopyTo([]); const c = data.classes.find((x) => x.id === id);
    setRows(Object.fromEntries((c?.subjects ?? []).map((s) => { const l = data.loads.find((x) => x.class_id === id && x.subject_id === s.id); return [s.id, { periods: l ? String(l.periods) : "", double: !!l?.double_period, max: l?.max_per_day ? String(l.max_per_day) : "" }]; }))); };
  return (
    <Card>
      <CardHeader title="How many periods a week each subject needs" />
      <CardBody className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Class" className="h-9 w-48" value={classId} onChange={(e) => pick(Number(e.target.value))}>{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <span className={total > capacity ? "font-semibold text-down" : "text-ink-700"}>{total} of {capacity} periods in the week{total > capacity ? ": more than the week has" : ""}</span>
        </div>
        {!cls?.subjects.length ? <p className="text-ink-500">This class has no subjects yet (Settings, Classes and subjects).</p> : (
          <table className="w-full max-w-2xl"><thead><tr className="text-left text-ink-500"><th className="py-1 font-medium">Subject</th><th className="py-1 font-medium">Periods a week</th><th className="py-1 font-medium">Double periods</th><th className="py-1 font-medium">At most a day</th></tr></thead>
            <tbody>{cls.subjects.map((s) => { const r = rows[s.id] ?? { periods: "", double: false, max: "" }; return (
              <tr key={s.id} className="border-t border-hair">
                <td className="py-1.5">{s.name}</td>
                <td className="py-1.5"><Input aria-label={`${s.name}: periods a week`} className="h-8 w-20" inputMode="numeric" disabled={!canEdit} value={r.periods} onChange={(e) => setRows({ ...rows, [s.id]: { ...r, periods: e.target.value } })} /></td>
                <td className="py-1.5"><input type="checkbox" aria-label={`${s.name}: double periods`} disabled={!canEdit} checked={r.double} onChange={(e) => setRows({ ...rows, [s.id]: { ...r, double: e.target.checked } })} /></td>
                <td className="py-1.5"><Input aria-label={`${s.name}: at most a day`} className="h-8 w-20" inputMode="numeric" placeholder="auto" disabled={!canEdit} value={r.max} onChange={(e) => setRows({ ...rows, [s.id]: { ...r, max: e.target.value } })} /></td>
              </tr>); })}</tbody></table>)}
        {canEdit && cls?.subjects.length ? <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => start(async () => {
            const out = cls.subjects.map((s) => ({ subjectId: s.id, periods: Number(rows[s.id]?.periods || 0), double: !!rows[s.id]?.double, maxPerDay: rows[s.id]?.max ? Number(rows[s.id].max) : null }));
            if (out.some((o) => Number.isNaN(o.periods) || (o.maxPerDay != null && Number.isNaN(o.maxPerDay)))) { setMsg({ ok: false, text: "Use whole numbers." }); return; }
            const r = await saveLoads(data.yearId, classId, out); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh();
          })}>Save</Button>
          <span className="text-ink-500">Copy these to:</span>
          <div className="flex flex-wrap gap-1">{data.classes.filter((c) => c.id !== classId).map((c) => (
            <label key={c.id} className="flex items-center gap-1 rounded-sm border border-hair px-1.5 py-0.5 text-[12px]"><input type="checkbox" checked={copyTo.includes(c.id)} onChange={(e) => setCopyTo(e.target.checked ? [...copyTo, c.id] : copyTo.filter((x) => x !== c.id))} />{c.name}</label>))}</div>
          <Button size="sm" variant="subtle" disabled={pending || !copyTo.length} onClick={() => start(async () => { const r = await copyLoads(data.yearId, classId, copyTo); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>Copy (save first)</Button>
        </div> : null}
        <Note m={msg} />
        <p className="text-[12px] text-ink-500">Teachers come from the subject allotments of each section (Settings, Teachers). Leave "At most a day" empty to spread the subject evenly.</p>
      </CardBody>
    </Card>
  );
}

function Availability({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const teaching = data.periods.filter((p) => !p.isBreak);
  const [staffId, setStaffId] = useState(data.teachers[0]?.id ?? 0);
  const of = (id: number) => new Set(data.unavailable.filter((u) => u.staff_id === id).map((u) => `${u.day_of_week}-${u.period_no}`));
  const [off, setOff] = useState<Set<string>>(() => of(staffId));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const days = DAYS.filter((d) => data.rules.days.includes(d.n));
  return (
    <Card>
      <CardHeader title="Periods a teacher cannot take" />
      <CardBody className="space-y-3 text-[13px]">
        <Select aria-label="Teacher" className="h-9 w-64" value={staffId} onChange={(e) => { const id = Number(e.target.value); setStaffId(id); setOff(of(id)); setMsg(null); }}>{data.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <table className="border-collapse"><thead><tr><th />{teaching.map((p) => <th key={p.no} className="px-1 text-[12px] font-medium text-ink-500">{p.label || p.no}</th>)}</tr></thead>
          <tbody>{days.map((d) => (
            <tr key={d.n}><td className="pr-2 text-ink-700">{d.short}</td>{teaching.map((p) => { const key = `${d.n}-${p.no}`, isOff = off.has(key); return (
              <td key={p.no} className="p-0.5"><button aria-label={`${d.long} ${p.label || p.no}: ${isOff ? "not available" : "available"}`} aria-pressed={isOff} disabled={!canEdit}
                onClick={() => { const n = new Set(off); if (isOff) n.delete(key); else n.add(key); setOff(n); }}
                className={`h-8 w-10 rounded-sm border text-[11px] ${isOff ? "border-down bg-down text-white" : "border-hair bg-white text-ink-500"}`}>{isOff ? "Off" : ""}</button></td>); })}</tr>))}</tbody></table>
        {canEdit && <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const cells = [...off].map((k) => { const [d, p] = k.split("-").map(Number); return { day: d, period: p }; });
          const r = await saveUnavailable(staffId, cells); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh();
        })}>Save</Button>}
        <Note m={msg} />
      </CardBody>
    </Card>
  );
}

function Rules({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const [days, setDays] = useState<number[]>(data.rules.days);
  const [max, setMax] = useState(String(data.rules.teacherMaxDay));
  const [ct, setCt] = useState(data.rules.classTeacherFirst);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card>
      <CardHeader title="Rules" />
      <CardBody className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-3"><span className="text-ink-700">Working days</span>{DAYS.map((d) => (
          <label key={d.n} className="flex items-center gap-1"><input type="checkbox" disabled={!canEdit} checked={days.includes(d.n)} onChange={(e) => setDays(e.target.checked ? [...days, d.n].sort() : days.filter((x) => x !== d.n))} />{d.short}</label>))}</div>
        <label className="flex items-center gap-2">A teacher teaches at most<Input aria-label="Periods a teacher teaches at most a day" className="h-8 w-16" inputMode="numeric" disabled={!canEdit} value={max} onChange={(e) => setMax(e.target.value)} />periods a day</label>
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={ct} onChange={(e) => setCt(e.target.checked)} />The class teacher takes the first period where possible</label>
        {canEdit && <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveRules(days, Number(max), ct); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>Save</Button>}
        <Note m={msg} />
      </CardBody>
    </Card>
  );
}

function Make({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const [classes, setClasses] = useState<number[]>(data.classes.map((c) => c.id));
  const [keep, setKeep] = useState(false);
  const [result, setResult] = useState<(SolverResult & { sectionIds: number[]; kept: SolverInputCell[] }) | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const teaching = data.periods.filter((p) => !p.isBreak).map((p) => p.no);
  const order = data.periods.map((p) => p.no);
  // a double can start where the next period of the day follows without a break
  const doubleStarts = data.periods.filter((p, i) => !p.isBreak && data.periods[i + 1] && !data.periods[i + 1].isBreak).map((p) => p.no);
  const subjName = useMemo(() => new Map(data.classes.flatMap((c) => c.subjects.map((s) => [s.id, s.code || s.name] as [number, string]))), [data.classes]);
  const subjFull = useMemo(() => new Map(data.classes.flatMap((c) => c.subjects.map((s) => [s.id, s.name] as [number, string]))), [data.classes]);
  const tName = useMemo(() => new Map(data.teachers.map((t) => [t.id, t.name])), [data.teachers]);
  const secLabel = useMemo(() => new Map(data.sections.map((s) => [s.id, s.label])), [data.sections]);
  const gen = data.sections.filter((s) => classes.includes(s.classId));
  const genIds = new Set(gen.map((s) => s.id));
  const teacherOf = (sec: number, sub: number) => data.allotments.find((a) => a.section_id === sec && a.subject_id === sub)?.staff_id ?? null;
  // teachers' weekly load, to warn before making
  const load = new Map<number, number>();
  for (const s of gen) for (const l of data.loads.filter((x) => x.class_id === s.classId)) { const t = teacherOf(s.id, l.subject_id); if (t) load.set(t, (load.get(t) ?? 0) + l.periods); }
  for (const sl of data.slots) if (!genIds.has(sl.section_id) && sl.staff_id) load.set(sl.staff_id, (load.get(sl.staff_id) ?? 0) + 1);
  const cap = data.rules.days.length * Math.min(teaching.length, data.rules.teacherMaxDay);
  const over = [...load.entries()].filter(([, n]) => n > cap).map(([t, n]) => `${tName.get(t) ?? "A teacher"} (${n})`);
  const noLoads = gen.filter((s) => !data.loads.some((l) => l.class_id === s.classId)).map((s) => s.label);
  const noTeacher = gen.flatMap((s) => data.loads.filter((l) => l.class_id === s.classId && l.periods > 0 && !teacherOf(s.id, l.subject_id)).map((l) => `${s.label} ${subjFull.get(l.subject_id) ?? ""}`));

  const make = () => {
    setBusy(true); setMsg(null); setResult(null);
    setTimeout(() => {
      const kept = keep ? data.slots.filter((x) => genIds.has(x.section_id) && x.subject_id != null).map((x) => ({ sectionId: x.section_id, day: x.day_of_week, period: x.period_no, subjectId: x.subject_id, staffId: x.staff_id })) : [];
      const busySlots = data.slots.filter((x) => !genIds.has(x.section_id) && x.staff_id != null).map((x) => ({ staffId: x.staff_id!, day: x.day_of_week, period: x.period_no }))
        .concat(data.unavailable.map((u) => ({ staffId: u.staff_id, day: u.day_of_week, period: u.period_no })));
      const r = solveTimetable({
        days: data.rules.days, periods: teaching, doubleStarts,
        sections: gen.map((s) => ({ id: s.id, classTeacherId: data.allotments.find((a) => a.section_id === s.id && a.is_class_teacher)?.staff_id ?? null })),
        loads: gen.flatMap((s) => data.loads.filter((l) => l.class_id === s.classId && l.periods > 0).map((l) => ({ sectionId: s.id, subjectId: l.subject_id, staffId: teacherOf(s.id, l.subject_id), periods: l.periods, double: l.double_period, maxPerDay: l.max_per_day }))),
        fixed: kept, busy: busySlots, teacherMaxDay: data.rules.teacherMaxDay, classTeacherFirst: data.rules.classTeacherFirst, timeMs: 3000,
      });
      setResult({ ...r, sectionIds: gen.map((s) => s.id), kept: kept as SolverInputCell[] }); setView(gen[0]?.id ?? null); setBusy(false);
    }, 30);
  };
  const cellsOf = (sec: number) => {
    const m = new Map<string, { sub: number | null; staff: number | null; kept: boolean }>();
    for (const c of result?.kept ?? []) if (c.sectionId === sec) m.set(`${c.day}-${c.period}`, { sub: c.subjectId, staff: c.staffId, kept: true });
    for (const c of result?.cells ?? []) if (c.sectionId === sec) m.set(`${c.day}-${c.period}`, { sub: c.subjectId, staff: c.staffId, kept: false });
    return m;
  };
  return (
    <Card>
      <CardHeader title="Make the timetable" />
      <CardBody className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-ink-700">Classes</span>{data.classes.map((c) => (
          <label key={c.id} className="flex items-center gap-1 rounded-sm border border-hair px-1.5 py-0.5 text-[12px]"><input type="checkbox" checked={classes.includes(c.id)} onChange={(e) => setClasses(e.target.checked ? [...classes, c.id] : classes.filter((x) => x !== c.id))} />{c.name}</label>))}</div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Keep the lessons already entered in these classes and fill the rest</label>
        {noLoads.length > 0 && <p className="text-down">No periods per week set for: {noLoads.slice(0, 10).join(", ")}{noLoads.length > 10 ? ` and ${noLoads.length - 10} more` : ""}.</p>}
        {noTeacher.length > 0 && <p className="text-ink-700">No teacher allotted (placed without a teacher): {noTeacher.slice(0, 8).join(", ")}{noTeacher.length > 8 ? ` and ${noTeacher.length - 8} more` : ""}.</p>}
        {over.length > 0 && <p className="text-down">More periods than the week allows ({cap}): {over.join(", ")}.</p>}
        <Button disabled={busy || !gen.length} onClick={make}>{busy ? "Making the timetable…" : `Make the timetable for ${gen.length} section${gen.length === 1 ? "" : "s"}`}</Button>
        {result && <div className="space-y-3">
          <p className={result.unplaced.length ? "font-semibold text-down" : "font-semibold text-up"}>{result.placed} of {result.wanted} lessons placed{result.unplaced.length ? "" : ", every lesson fits"}. No teacher is in two places.</p>
          {result.unplaced.length > 0 && <ul className="list-disc pl-5 text-ink-700">{result.unplaced.slice(0, 30).map((u, i) => <li key={i}>{secLabel.get(u.sectionId)}: {subjFull.get(u.subjectId)}, {u.count} period{u.count === 1 ? "" : "s"} not placed. {u.reason}</li>)}</ul>}
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Section to preview" className="h-9 w-48" value={view ?? ""} onChange={(e) => setView(Number(e.target.value))}>{gen.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
            {canEdit && <Button disabled={pending} onClick={() => start(async () => {
              const rows = [...(result.kept ?? []), ...result.cells].filter((c) => c.subjectId != null).map((c) => ({ section_id: c.sectionId, day: c.day, period: c.period, subject_id: c.subjectId as number, staff_id: c.staffId }));
              const r = await saveGenerated(data.yearId, result.sectionIds, rows); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh();
            })}>Save this timetable</Button>}
            <Button variant="subtle" disabled={busy} onClick={make}>Make another</Button>
          </div>
          {view != null && <div className="overflow-x-auto"><table className="border-collapse text-[12px]">
            <thead><tr><th />{order.map((p) => { const per = data.periods.find((x) => x.no === p)!; return <th key={p} className={`px-1 py-1 font-medium ${per.isBreak ? "text-ink-400" : "text-ink-500"}`}>{per.label || p}</th>; })}</tr></thead>
            <tbody>{DAYS.filter((d) => data.rules.days.includes(d.n)).map((d) => { const m = cellsOf(view); return (
              <tr key={d.n}><td className="pr-2 text-ink-700">{d.short}</td>{order.map((p) => { const per = data.periods.find((x) => x.no === p)!; const c = m.get(`${d.n}-${p}`);
                return <td key={p} className={`h-11 w-24 border border-hair px-1 align-top ${per.isBreak ? "bg-panel" : c?.kept ? "bg-[#F5F9FE]" : "bg-white"}`}>{c ? <><div className="font-medium">{subjName.get(c.sub ?? 0) ?? ""}</div><div className="truncate text-ink-500">{c.staff ? tName.get(c.staff) ?? "" : "no teacher"}</div></> : null}</td>; })}</tr>); })}</tbody></table></div>}
        </div>}
        <Note m={msg} />
      </CardBody>
    </Card>
  );
}
type SolverInputCell = { sectionId: number; day: number; period: number; subjectId: number | null; staffId: number | null };
