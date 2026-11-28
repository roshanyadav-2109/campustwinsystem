"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { solveTimetable, type SolverInput, type SolverResult, type SolverCell, type SolverFixed } from "@/lib/timetable-solver";
import { saveLoads, copyLoads, saveUnavailable, saveRules, saveShape, saveGroup, deleteGroup, saveGenerated, saveConsecutive, saveDraft, deleteDraft, type SaveRow } from "@/app/dashboard/schedule/generate/actions";
import { DAYS, toggleCls } from "@/components/schedule/shared";
import { downloadPdf, downloadPdfBook } from "@/lib/pdf";
import { timetablePdf } from "@/components/schedule/print";

export type GenData = {
  yearId: number; yearName: string;
  periods: { no: number; label: string; isBreak: boolean; start: string }[];
  classes: { id: number; name: string; subjects: { id: number; name: string; code: string }[] }[];
  sections: { id: number; label: string; classId: number }[];
  teachers: { id: number; name: string }[];
  loads: { class_id: number; subject_id: number; periods: number; double_period: boolean; max_per_day: number | null; room: string | null }[];
  allotments: { section_id: number; subject_id: number; staff_id: number; is_class_teacher: boolean; component?: string | null; batch?: string | null }[];
  unavailable: { staff_id: number; day_of_week: number; period_no: number }[];
  slots: { id: number; section_id: number; day_of_week: number; period_no: number; subject_id: number | null; staff_id: number | null; room: string | null; group_id: number | null; extra: { subject_id: number; staff_id: number | null }[] | null }[];
  groups: { id: number; label: string; sectionIds: number[]; periods: number; double: boolean; maxPerDay: number | null; room: string | null; items: { subjectId: number; staffId: number | null }[] }[];
  rules: { days: number[]; teacherMaxDay: number; maxConsecutive: number; classTeacherFirst: boolean; dayPeriods: Record<number, number>; blocked: { day: number; period: number }[] };
  drafts: { id: number; name: string; section_ids: number[]; rows: SaveRow[]; created_at: string }[];
};
type Tab = "loads" | "groups" | "teachers" | "rules" | "make";
type Msg = { ok: boolean; text: string } | null;

function Note({ m }: { m: Msg }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p>;
}
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function TimetableGenerator({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("loads");
  const tabs: [Tab, string][] = [["loads", "Periods per week"], ["groups", "Combined and split lessons"], ["teachers", "Teacher availability"], ["rules", "Rules and the day"], ["make", "Make the timetable"]];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{tabs.map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} className={`inline-flex h-9 items-center rounded-sm border px-3 text-[13px] font-medium ${toggleCls(tab === k)}`}>{l}</button>))}</div>
      {tab === "loads" && <Loads data={data} canEdit={canEdit} />}
      {tab === "groups" && <Groups data={data} canEdit={canEdit} />}
      {tab === "teachers" && <Availability data={data} canEdit={canEdit} />}
      {tab === "rules" && <Rules data={data} canEdit={canEdit} />}
      {tab === "make" && <Make data={data} canEdit={canEdit} />}
    </div>
  );
}

const teachingPerWeek = (data: GenData) => {
  const teaching = data.periods.filter((p) => !p.isBreak);
  const blocked = new Set(data.rules.blocked.map((b) => `${b.day}|${b.period}`));
  return data.rules.days.reduce((a, d) => a + teaching.filter((p, i) => !blocked.has(`${d}|${p.no}`) && (data.rules.dayPeriods[d] == null || i < data.rules.dayPeriods[d])).length, 0);
};

function Loads({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const rowsFor = (id: number) => Object.fromEntries((data.classes.find((c) => c.id === id)?.subjects ?? []).map((s) => {
    const l = data.loads.find((x) => x.class_id === id && x.subject_id === s.id);
    return [s.id, { periods: l ? String(l.periods) : "", double: !!l?.double_period, max: l?.max_per_day ? String(l.max_per_day) : "", room: l?.room ?? "" }];
  }));
  const [classId, setClassId] = useState(data.classes[0]?.id ?? 0);
  const [rows, setRows] = useState<Record<number, { periods: string; double: boolean; max: string; room: string }>>(() => rowsFor(data.classes[0]?.id ?? 0));
  const [copyTo, setCopyTo] = useState<number[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const cls = data.classes.find((c) => c.id === classId);
  const capacity = teachingPerWeek(data);
  const inGroups = data.groups.filter((g) => g.sectionIds.some((s) => data.sections.find((x) => x.id === s)?.classId === classId)).reduce((a, g) => a + g.periods, 0);
  const total = Object.values(rows).reduce((a, r) => a + (Number(r.periods) || 0), 0) + inGroups;
  return (
    <Card>
      <CardHeader title="How many periods a week each subject needs" />
      <CardBody className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Class" className="h-9 w-48" value={classId} onChange={(e) => { const id = Number(e.target.value); setClassId(id); setRows(rowsFor(id)); setMsg(null); setCopyTo([]); }}>{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <span className={total > capacity ? "font-semibold text-down" : "text-ink-700"}>{total} of {capacity} periods in the week{inGroups ? ` (${inGroups} in combined or split lessons)` : ""}{total > capacity ? ": more than the week has" : ""}</span>
        </div>
        {!cls?.subjects.length ? <p className="text-ink-500">This class has no subjects yet (Settings, Classes and subjects).</p> : (
          <table className="w-full max-w-3xl"><thead><tr className="text-left text-ink-500"><th className="py-1 font-medium">Subject</th><th className="py-1 font-medium">Periods a week</th><th className="py-1 font-medium">Double periods</th><th className="py-1 font-medium">At most a day</th><th className="py-1 font-medium">Room or lab</th></tr></thead>
            <tbody>{cls.subjects.map((s) => { const r = rows[s.id] ?? { periods: "", double: false, max: "", room: "" }; const set = (x: Partial<typeof r>) => setRows({ ...rows, [s.id]: { ...r, ...x } }); return (
              <tr key={s.id} className="border-t border-hair">
                <td className="py-1.5">{s.name}</td>
                <td className="py-1.5"><Input aria-label={`${s.name}: periods a week`} className="h-8 w-20" inputMode="numeric" disabled={!canEdit} value={r.periods} onChange={(e) => set({ periods: e.target.value })} /></td>
                <td className="py-1.5"><input type="checkbox" aria-label={`${s.name}: double periods`} disabled={!canEdit} checked={r.double} onChange={(e) => set({ double: e.target.checked })} /></td>
                <td className="py-1.5"><Input aria-label={`${s.name}: at most a day`} className="h-8 w-20" inputMode="numeric" placeholder="auto" disabled={!canEdit} value={r.max} onChange={(e) => set({ max: e.target.value })} /></td>
                <td className="py-1.5"><Input aria-label={`${s.name}: room`} className="h-8 w-40" placeholder="any" maxLength={40} disabled={!canEdit} value={r.room} onChange={(e) => set({ room: e.target.value })} /></td>
              </tr>); })}</tbody></table>)}
        {canEdit && cls?.subjects.length ? <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => start(async () => {
            const out = cls.subjects.map((s) => ({ subjectId: s.id, periods: Number(rows[s.id]?.periods || 0), double: !!rows[s.id]?.double, maxPerDay: num(rows[s.id]?.max ?? ""), room: rows[s.id]?.room || null }));
            if (out.some((o) => Number.isNaN(o.periods) || (o.maxPerDay != null && Number.isNaN(o.maxPerDay)))) { setMsg({ ok: false, text: "Use whole numbers." }); return; }
            const r = await saveLoads(data.yearId, classId, out); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh();
          })}>Save</Button>
          <span className="text-ink-500">Copy these to:</span>
          <div className="flex flex-wrap gap-1">{data.classes.filter((c) => c.id !== classId).map((c) => (
            <label key={c.id} className="flex items-center gap-1 rounded-sm border border-hair px-1.5 py-0.5 text-[12px]"><input type="checkbox" checked={copyTo.includes(c.id)} onChange={(e) => setCopyTo(e.target.checked ? [...copyTo, c.id] : copyTo.filter((x) => x !== c.id))} />{c.name}</label>))}</div>
          <Button size="sm" variant="subtle" disabled={pending || !copyTo.length} onClick={() => start(async () => { const r = await copyLoads(data.yearId, classId, copyTo); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>Copy (save first)</Button>
        </div> : null}
        <Note m={msg} />
        <p className="text-[12px] text-ink-500">Teachers come from each section&apos;s subject allotments (Settings, Teachers). A room or lab named here holds one class at a time. Subjects taught in a combined or split lesson are set on that tab instead (leave them 0 here).</p>
      </CardBody>
    </Card>
  );
}

function Groups({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  type Draft = { id: number | null; label: string; sectionIds: number[]; periods: string; double: boolean; max: string; room: string; items: { subjectId: number; staffId: number | null }[] };
  const blank: Draft = { id: null, label: "", sectionIds: [], periods: "", double: false, max: "", room: "", items: [] };
  const [d, setD] = useState<Draft>(blank);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const subjects = useMemo(() => { const m = new Map<number, string>(); for (const c of data.classes) for (const s of c.subjects) m.set(s.id, s.name); return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); }, [data.classes]);
  const subjName = new Map(subjects.map((s) => [s.id, s.name]));
  const tName = new Map(data.teachers.map((t) => [t.id, t.name]));
  const secLabel = new Map(data.sections.map((s) => [s.id, s.label]));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Lessons taught together or split" />
        <CardBody className="space-y-2 text-[13px]">
          <p className="text-ink-700"><b>Combined:</b> two or more sections with one teacher at once (games, library, moral science). <b>Split:</b> a section, or sections together, divided into groups with their own subject and teacher at the same time (second language, optional subjects, boys&apos; and girls&apos; PE).</p>
          {data.groups.length === 0 ? <p className="text-ink-500">None yet.</p> : (
            <ul className="space-y-1">{data.groups.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 border-t border-hair pt-1">
                <b>{g.label}</b><span className="text-ink-700">{g.sectionIds.map((s) => secLabel.get(s)).join(", ")}: {g.items.map((i) => `${subjName.get(i.subjectId) ?? ""}${i.staffId ? ` (${tName.get(i.staffId) ?? ""})` : ""}`).join(" / ")}; {g.periods} a week{g.double ? ", doubles" : ""}{g.room ? `, ${g.room}` : ""}</span>
                {canEdit && <><Button size="sm" variant="ghost" onClick={() => setD({ id: g.id, label: g.label, sectionIds: g.sectionIds, periods: String(g.periods), double: g.double, max: g.maxPerDay ? String(g.maxPerDay) : "", room: g.room ?? "", items: g.items })}>Change</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await deleteGroup(g.id); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh(); })}>Remove</Button></>}
              </li>))}</ul>)}
        </CardBody>
      </Card>
      {canEdit && <Card>
        <CardHeader title={d.id ? "Change the lesson" : "Add a combined or split lesson"} />
        <CardBody className="space-y-2 text-[13px]">
          <div className="flex flex-wrap items-end gap-2">
            <label>Name<Input aria-label="Lesson name" className="mt-1 h-8 w-52" placeholder="Second language" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></label>
            <label>Periods a week<Input aria-label="Group periods a week" className="mt-1 h-8 w-20" inputMode="numeric" value={d.periods} onChange={(e) => setD({ ...d, periods: e.target.value })} /></label>
            <label>At most a day<Input aria-label="Group at most a day" className="mt-1 h-8 w-20" inputMode="numeric" placeholder="auto" value={d.max} onChange={(e) => setD({ ...d, max: e.target.value })} /></label>
            <label>Room<Input aria-label="Group room" className="mt-1 h-8 w-36" placeholder="any" value={d.room} onChange={(e) => setD({ ...d, room: e.target.value })} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={d.double} onChange={(e) => setD({ ...d, double: e.target.checked })} />Double periods</label>
          </div>
          <div className="flex flex-wrap gap-1"><span className="mr-1 text-ink-700">Sections</span>{data.sections.map((s) => (
            <label key={s.id} className="flex items-center gap-1 rounded-sm border border-hair px-1.5 py-0.5 text-[12px]"><input type="checkbox" aria-label={`Section ${s.label}`} checked={d.sectionIds.includes(s.id)} onChange={(e) => setD({ ...d, sectionIds: e.target.checked ? [...d.sectionIds, s.id] : d.sectionIds.filter((x) => x !== s.id) })} />{s.label}</label>))}</div>
          <div className="space-y-1">{d.items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label={`Subject ${i + 1}`} className="h-8 w-48" value={it.subjectId} onChange={(e) => setD({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, subjectId: Number(e.target.value) } : x)) })}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              <Select aria-label={`Teacher ${i + 1}`} className="h-8 w-56" value={it.staffId ?? ""} onChange={(e) => setD({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, staffId: e.target.value ? Number(e.target.value) : null } : x)) })}><option value="">No teacher yet</option>{data.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
              <Button size="sm" variant="ghost" onClick={() => setD({ ...d, items: d.items.filter((_, j) => j !== i) })}>Remove</Button>
            </div>))}
            <Button size="sm" variant="subtle" disabled={!subjects.length} onClick={() => setD({ ...d, items: [...d.items, { subjectId: subjects[0].id, staffId: null }] })}>Add a subject and teacher</Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => start(async () => {
              const r = await saveGroup(data.yearId, { id: d.id, label: d.label, sectionIds: d.sectionIds, periods: Number(d.periods), double: d.double, maxPerDay: num(d.max), room: d.room || null, items: d.items });
              setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) { setD(blank); router.refresh(); }
            })}>Save the lesson</Button>
            {d.id && <Button size="sm" variant="ghost" onClick={() => setD(blank)}>Cancel</Button>}
          </div>
          <Note m={msg} />
        </CardBody>
      </Card>}
    </div>
  );
}

function Availability({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const teaching = data.periods.filter((p) => !p.isBreak);
  const [staffId, setStaffId] = useState(data.teachers[0]?.id ?? 0);
  const of = (id: number) => new Set(data.unavailable.filter((u) => u.staff_id === id).map((u) => `${u.day_of_week}-${u.period_no}`));
  const [off, setOff] = useState<Set<string>>(() => of(data.teachers[0]?.id ?? 0));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const days = DAYS.filter((d) => data.rules.days.includes(d.n));
  return (
    <Card>
      <CardHeader title="Periods a teacher cannot take" />
      <CardBody className="space-y-3 text-[13px]">
        <Select aria-label="Teacher" className="h-9 w-64" value={staffId} onChange={(e) => { const id = Number(e.target.value); setStaffId(id); setOff(of(id)); setMsg(null); }}>{data.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Grid days={days} periods={teaching} isOn={(d, p) => off.has(`${d}-${p}`)} onLabel="Off" disabled={!canEdit} label={(d, p, on) => `${d} ${p}: ${on ? "not available" : "available"}`}
          toggle={(d, p) => { const n = new Set(off); const k = `${d}-${p}`; if (n.has(k)) n.delete(k); else n.add(k); setOff(n); }} />
        {canEdit && <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const cells = [...off].map((k) => { const [d, p] = k.split("-").map(Number); return { day: d, period: p }; });
          const r = await saveUnavailable(staffId, cells); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) router.refresh();
        })}>Save</Button>}
        <Note m={msg} />
      </CardBody>
    </Card>
  );
}

function Grid({ days, periods, isOn, toggle, onLabel, disabled, label }: { days: readonly { n: number; short: string; long: string }[]; periods: { no: number; label: string }[];
  isOn: (d: number, p: number) => boolean; toggle: (d: number, p: number) => void; onLabel: string; disabled: boolean; label: (d: string, p: string, on: boolean) => string }) {
  return (
    <table className="border-collapse"><thead><tr><th />{periods.map((p) => <th key={p.no} className="px-1 text-[12px] font-medium text-ink-500">{p.label || p.no}</th>)}</tr></thead>
      <tbody>{days.map((d) => (
        <tr key={d.n}><td className="pr-2 text-ink-700">{d.short}</td>{periods.map((p) => { const on = isOn(d.n, p.no); return (
          <td key={p.no} className="p-0.5"><button aria-label={label(d.long, p.label || String(p.no), on)} aria-pressed={on} disabled={disabled} onClick={() => toggle(d.n, p.no)}
            className={`h-8 w-10 rounded-sm border text-[11px] ${on ? "border-down bg-down text-white" : "border-hair bg-white text-ink-500"}`}>{on ? onLabel : ""}</button></td>); })}</tr>))}</tbody></table>
  );
}

function Rules({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const teaching = data.periods.filter((p) => !p.isBreak);
  const [days, setDays] = useState<number[]>(data.rules.days);
  const [max, setMax] = useState(String(data.rules.teacherMaxDay));
  const [ct, setCt] = useState(data.rules.classTeacherFirst);
  const [cons, setCons] = useState(String(data.rules.maxConsecutive));
  const [dp, setDp] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(data.rules.dayPeriods).map(([k, v]) => [Number(k), String(v)])));
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set(data.rules.blocked.map((b) => `${b.day}-${b.period}`)));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card>
      <CardHeader title="Rules and the shape of the day" />
      <CardBody className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-3"><span className="text-ink-700">Working days</span>{DAYS.map((d) => (
          <label key={d.n} className="flex items-center gap-1"><input type="checkbox" disabled={!canEdit} checked={days.includes(d.n)} onChange={(e) => setDays(e.target.checked ? [...days, d.n].sort() : days.filter((x) => x !== d.n))} />{d.short}</label>))}</div>
        <div className="flex flex-wrap items-center gap-3"><span className="text-ink-700">Teaching periods on a shorter day</span>{DAYS.filter((d) => days.includes(d.n)).map((d) => (
          <label key={d.n} className="flex items-center gap-1">{d.short}<Input aria-label={`${d.long}: teaching periods`} className="h-8 w-14" inputMode="numeric" placeholder={String(teaching.length)} disabled={!canEdit} value={dp[d.n] ?? ""} onChange={(e) => setDp({ ...dp, [d.n]: e.target.value })} /></label>))}</div>
        <label className="flex items-center gap-2">A teacher teaches at most<Input aria-label="Periods a teacher teaches at most a day" className="h-8 w-16" inputMode="numeric" disabled={!canEdit} value={max} onChange={(e) => setMax(e.target.value)} />periods a day</label>
        <label className="flex items-center gap-2">and at most<Input aria-label="Periods in a row at most" className="h-8 w-16" inputMode="numeric" disabled={!canEdit} value={cons} onChange={(e) => setCons(e.target.value)} />periods in a row</label>
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={ct} onChange={(e) => setCt(e.target.checked)} />The class teacher takes the first period where possible</label>
        <p className="text-ink-700">Periods with no lessons for anyone (assembly, clubs):</p>
        <Grid days={DAYS.filter((d) => days.includes(d.n))} periods={teaching} isOn={(d, p) => blocked.has(`${d}-${p}`)} onLabel="No" disabled={!canEdit} label={(d, p, on) => `${d} ${p}: ${on ? "no lessons" : "lessons"}`}
          toggle={(d, p) => { const n = new Set(blocked); const k = `${d}-${p}`; if (n.has(k)) n.delete(k); else n.add(k); setBlocked(n); }} />
        {canEdit && <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const r1 = await saveRules(days, Number(max), ct);
          if (!r1.ok) { setMsg({ ok: false, text: r1.error }); return; }
          const r0 = await saveConsecutive(Number(cons) || 4);
          if (!r0.ok) { setMsg({ ok: false, text: r0.error }); return; }
          const shape = Object.fromEntries(Object.entries(dp).filter(([, v]) => v.trim() !== "").map(([k, v]) => [Number(k), Number(v)]));
          if (Object.values(shape).some((v) => !Number.isInteger(v) || v < 1 || v > teaching.length)) { setMsg({ ok: false, text: `A day has 1 to ${teaching.length} teaching periods.` }); return; }
          const r2 = await saveShape(shape, [...blocked].map((k) => { const [d, p] = k.split("-").map(Number); return { day: d, period: p }; }));
          setMsg(r2.ok ? { ok: true, text: "Saved." } : { ok: false, text: r2.error }); if (r2.ok) router.refresh();
        })}>Save</Button>}
        <Note m={msg} />
      </CardBody>
    </Card>
  );
}

type Result = SolverResult & { sectionIds: number[]; kept: SolverCell[] };

function Make({ data, canEdit }: { data: GenData; canEdit: boolean }) {
  const [classes, setClasses] = useState<number[]>(data.classes.map((c) => c.id));
  const [keep, setKeep] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<{ sec: number; d: number; p: number } | null>(null);
  const [mode, setMode] = useState<"swap" | "lock">("swap");
  const [confirm, setConfirm] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const teaching = data.periods.filter((p) => !p.isBreak).map((p) => p.no);
  const doubleStarts = data.periods.filter((p, i) => !p.isBreak && data.periods[i + 1] && !data.periods[i + 1].isBreak).map((p) => p.no);
  const subjName = useMemo(() => new Map(data.classes.flatMap((c) => c.subjects.map((s) => [s.id, s.code || s.name] as [number, string]))), [data.classes]);
  const subjFull = useMemo(() => new Map(data.classes.flatMap((c) => c.subjects.map((s) => [s.id, s.name] as [number, string]))), [data.classes]);
  const tName = useMemo(() => new Map(data.teachers.map((t) => [t.id, t.name])), [data.teachers]);
  const secLabel = useMemo(() => new Map(data.sections.map((s) => [s.id, s.label])), [data.sections]);
  const groupLabel = useMemo(() => new Map(data.groups.map((g) => [g.id, g.label])), [data.groups]);
  const allot = useMemo(() => {
    // one teacher per section and subject: the whole-subject (or theory) teacher before a lab-batch or practical teacher
    const m = new Map<string, number>(), main = new Set<string>();
    for (const a of data.allotments) if (a.subject_id) {
      const k = `${a.section_id}|${a.subject_id}`, isMain = !a.batch && (!a.component || a.component === "theory");
      if (isMain || (!m.has(k) && !main.has(k))) { m.set(k, a.staff_id); if (isMain) main.add(k); }
    }
    return m;
  }, [data.allotments]);
  const ctOf = useMemo(() => new Map(data.allotments.filter((a) => a.is_class_teacher).map((a) => [a.section_id, a.staff_id])), [data.allotments]);
  // only sections that have something to place
  const gen = data.sections.filter((s) => classes.includes(s.classId) && (data.loads.some((l) => l.class_id === s.classId && l.periods > 0) || data.groups.some((g) => g.sectionIds.includes(s.id))));
  const genIds = new Set(gen.map((s) => s.id));
  const groups = data.groups.filter((g) => g.sectionIds.every((s) => genIds.has(s)));
  const partialGroups = data.groups.filter((g) => g.sectionIds.some((s) => genIds.has(s)) && !g.sectionIds.every((s) => genIds.has(s)));
  const cap = data.rules.days.length * Math.min(teaching.length, data.rules.teacherMaxDay);
  const load = new Map<number, number>();
  for (const s of gen) for (const l of data.loads.filter((x) => x.class_id === s.classId)) { const t = allot.get(`${s.id}|${l.subject_id}`); if (t) load.set(t, (load.get(t) ?? 0) + l.periods); }
  for (const g of groups) for (const i of g.items) if (i.staffId) load.set(i.staffId, (load.get(i.staffId) ?? 0) + g.periods);
  const over = [...load.entries()].filter(([, n]) => n > cap).map(([t, n]) => `${tName.get(t) ?? "A teacher"} (${n})`);
  const noTeacher = gen.flatMap((s) => data.loads.filter((l) => l.class_id === s.classId && l.periods > 0 && !allot.get(`${s.id}|${l.subject_id}`)).map((l) => `${s.label} ${subjFull.get(l.subject_id) ?? ""}`));
  const slotStaff = (x: GenData["slots"][number]) => [x.staff_id, ...(x.extra ?? []).map((e) => e.staff_id)].filter((v): v is number => v != null);

  const input = (fixedExtra: SolverFixed[]): SolverInput => {
    const kept: SolverFixed[] = keep ? data.slots.filter((x) => genIds.has(x.section_id) && x.subject_id != null).map((x) => ({ sectionId: x.section_id, day: x.day_of_week, period: x.period_no, subjectId: x.subject_id, staffIds: slotStaff(x), room: x.room, groupId: x.group_id })) : [];
    const keyed = new Set(fixedExtra.map((f) => `${f.sectionId}|${f.day}|${f.period}`));
    return {
      days: data.rules.days, periods: teaching, doubleStarts, dayPeriods: data.rules.dayPeriods, blocked: data.rules.blocked,
      sections: gen.map((s) => ({ id: s.id, classTeacherId: ctOf.get(s.id) ?? null })),
      loads: gen.flatMap((s) => data.loads.filter((l) => l.class_id === s.classId && l.periods > 0).map((l) => ({ sectionId: s.id, subjectId: l.subject_id, staffId: allot.get(`${s.id}|${l.subject_id}`) ?? null, periods: l.periods, double: l.double_period, maxPerDay: l.max_per_day, room: l.room }))),
      groups: groups.map((g) => ({ id: g.id, sectionIds: g.sectionIds, items: g.items, periods: g.periods, double: g.double, maxPerDay: g.maxPerDay, room: g.room })),
      fixed: [...kept.filter((k) => !keyed.has(`${k.sectionId}|${k.day}|${k.period}`)), ...fixedExtra],
      busy: data.unavailable.map((u) => ({ staffId: u.staff_id, day: u.day_of_week, period: u.period_no })),
      elsewhere: data.slots.filter((x) => !genIds.has(x.section_id)).flatMap((x) => { const st = slotStaff(x); return (st.length ? st : [null]).map((t) => ({ staffId: t, day: x.day_of_week, period: x.period_no, room: x.room })); }),
      teacherMaxDay: data.rules.teacherMaxDay, maxConsecutive: data.rules.maxConsecutive, classTeacherFirst: data.rules.classTeacherFirst, timeMs: 4000, seed: Math.floor(Math.random() * 1e9),
    };
  };
  const make = () => {
    setBusy(true); setMsg(null); setConfirm(false);
    // locked cells of the last result stay where they are
    const lockedCells: SolverFixed[] = (result?.cells ?? []).filter((c) => locked.has(`${c.sectionId}|${c.day}|${c.period}`))
      .map((c) => ({ sectionId: c.sectionId, day: c.day, period: c.period, subjectId: c.subjectId, staffIds: [c.staffId, ...c.extras.map((e) => e.staffId)].filter((v): v is number => v != null), room: c.room, groupId: c.groupId }));
    const inp = input(lockedCells);
    const done = (r: SolverResult) => {
      const lockedFull: SolverCell[] = (result?.cells ?? []).filter((c) => locked.has(`${c.sectionId}|${c.day}|${c.period}`));
      const keptCells: SolverCell[] = keep ? data.slots.filter((x) => genIds.has(x.section_id) && x.subject_id != null && !locked.has(`${x.section_id}|${x.day_of_week}|${x.period_no}`))
        .map((x) => ({ sectionId: x.section_id, day: x.day_of_week, period: x.period_no, subjectId: x.subject_id!, staffId: x.staff_id, groupId: x.group_id, room: x.room, extras: (x.extra ?? []).map((e) => ({ subjectId: e.subject_id, staffId: e.staff_id })) })) : [];
      setResult({ ...r, cells: [...r.cells, ...lockedFull], sectionIds: gen.map((s) => s.id), kept: keptCells });
      setView((v) => v ?? gen[0]?.id ?? null); setBusy(false); worker.current = null;
    };
    try {
      const w = new Worker(new URL("../../lib/timetable-worker.ts", import.meta.url));
      worker.current = w;
      w.onmessage = (e) => { done(e.data as SolverResult); w.terminate(); };
      w.onerror = () => { w.terminate(); setTimeout(() => done(solveTimetable(inp)), 20); };
      w.postMessage(inp);
    } catch { setTimeout(() => done(solveTimetable(inp)), 20); }
  };
  const cancel = () => { worker.current?.terminate(); worker.current = null; setBusy(false); };

  const allCells = useMemo(() => [...(result?.kept ?? []), ...(result?.cells ?? [])], [result]);
  const cellsOf = (sec: number) => { const m = new Map<string, SolverCell & { kept?: boolean }>(); for (const c of result?.kept ?? []) if (c.sectionId === sec) m.set(`${c.day}-${c.period}`, { ...c, kept: true }); for (const c of result?.cells ?? []) if (c.sectionId === sec) m.set(`${c.day}-${c.period}`, c); return m; };
  const label = (c: SolverCell | undefined) => !c ? "" : c.groupId && c.extras.length ? groupLabel.get(c.groupId) ?? "" : subjName.get(c.subjectId) ?? "";
  const teachers = (c: SolverCell) => [c.staffId, ...c.extras.map((e) => e.staffId)].filter((v): v is number => v != null);
  // swap two cells of one section when no teacher or room ends up in two places
  const trySwap = (sec: number, a: { d: number; p: number }, b: { d: number; p: number }) => {
    if (!result) return;
    const ca = result.cells.find((c) => c.sectionId === sec && c.day === a.d && c.period === a.p);
    const cb = result.cells.find((c) => c.sectionId === sec && c.day === b.d && c.period === b.p);
    if ((ca?.groupId && (data.groups.find((g) => g.id === ca.groupId)?.sectionIds.length ?? 1) > 1) || (cb?.groupId && (data.groups.find((g) => g.id === cb.groupId)?.sectionIds.length ?? 1) > 1)) { setMsg({ ok: false, text: "A lesson shared with other sections cannot be moved on its own." }); return; }
    if (result.kept.some((c) => c.sectionId === sec && ((c.day === a.d && c.period === a.p) || (c.day === b.d && c.period === b.p)))) { setMsg({ ok: false, text: "A kept lesson cannot be moved here." }); return; }
    const busyAt = (t: number, d: number, p: number, except: (SolverCell | undefined)[]) => allCells.some((c) => !except.includes(c) && c.day === d && c.period === p && teachers(c).includes(t))
      || data.unavailable.some((u) => u.staff_id === t && u.day_of_week === d && u.period_no === p)
      || data.slots.some((x) => !genIds.has(x.section_id) && x.day_of_week === d && x.period_no === p && slotStaff(x).includes(t));
    for (const t of ca ? teachers(ca) : []) if (busyAt(t, b.d, b.p, [ca, cb])) { setMsg({ ok: false, text: `${tName.get(t) ?? "A teacher"} is busy then.` }); return; }
    for (const t of cb ? teachers(cb) : []) if (busyAt(t, a.d, a.p, [ca, cb])) { setMsg({ ok: false, text: `${tName.get(t) ?? "A teacher"} is busy then.` }); return; }
    setResult({ ...result, cells: result.cells.map((c) => (c === ca ? { ...c, day: b.d, period: b.p } : c === cb ? { ...c, day: a.d, period: a.p } : c)) });
    setMsg({ ok: true, text: "Swapped." });
  };
  const click = (sec: number, d: number, p: number) => {
    if (mode === "lock") { const k = `${sec}|${d}|${p}`; const n = new Set(locked); if (n.has(k)) n.delete(k); else n.add(k); setLocked(n); return; }
    if (!pick || pick.sec !== sec) { setPick({ sec, d, p }); return; }
    if (pick.d !== d || pick.p !== p) trySwap(sec, pick, { d, p });
    setPick(null);
  };
  const rows = (): SaveRow[] => allCells.map((c) => ({ section_id: c.sectionId, day: c.day, period: c.period, subject_id: c.subjectId, staff_id: c.staffId, room: c.room, group_id: c.groupId,
    extras: c.extras.map((e) => ({ subject_id: e.subjectId, staff_id: e.staffId })) }));
  const replacing = data.slots.filter((x) => genIds.has(x.section_id)).length;
  const printOne = (sec: number) => { const m = cellsOf(sec); return timetablePdf(secLabel.get(sec) ?? "", [data.yearName], data.rules.days, data.periods, (d, p) => { const c = m.get(`${d}-${p}`); return c ? `${label(c)}${teachers(c).length ? `\n${teachers(c).map((t) => tName.get(t) ?? "").join(", ")}` : ""}${c.room ? `\n${c.room}` : ""}` : ""; }); };
  const printTeacher = (t: number) => timetablePdf(tName.get(t) ?? "", [data.yearName], data.rules.days, data.periods, (d, p) => {
    const here = allCells.filter((c) => c.day === d && c.period === p && teachers(c).includes(t));
    if (!here.length) return "";
    const sub = here[0].staffId === t ? subjName.get(here[0].subjectId) : subjName.get(here[0].extras.find((e) => e.staffId === t)?.subjectId ?? 0);
    return `${here.map((c) => secLabel.get(c.sectionId)).join(", ")}\n${sub ?? ""}`;
  });

  return (
    <Card>
      <CardHeader title="Make the timetable" />
      <CardBody className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-ink-700">Classes</span>{data.classes.map((c) => (
          <label key={c.id} className="flex items-center gap-1 rounded-sm border border-hair px-1.5 py-0.5 text-[12px]"><input type="checkbox" checked={classes.includes(c.id)} onChange={(e) => setClasses(e.target.checked ? [...classes, c.id] : classes.filter((x) => x !== c.id))} />{c.name}</label>))}</div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Keep the lessons already entered in these classes and fill the rest</label>
        {gen.length === 0 && <p className="text-down">None of the chosen classes has periods per week or lessons set yet.</p>}
        {partialGroups.length > 0 && <p className="text-down">Lessons shared with classes not chosen are left out: {partialGroups.map((g) => g.label).join(", ")}. Choose all their classes to include them.</p>}
        {noTeacher.length > 0 && <p className="text-ink-700">No teacher allotted (placed without a teacher): {noTeacher.slice(0, 8).join(", ")}{noTeacher.length > 8 ? ` and ${noTeacher.length - 8} more` : ""}.</p>}
        {over.length > 0 && <p className="text-down">More periods than the week allows ({cap}): {over.join(", ")}.</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !gen.length} onClick={make}>{busy ? "Making the timetable…" : result ? "Make another" : `Make the timetable for ${gen.length} section${gen.length === 1 ? "" : "s"}`}</Button>
          {busy && <Button variant="ghost" onClick={cancel}>Stop</Button>}
        </div>
        {data.drafts.length > 0 && <div className="flex flex-wrap items-center gap-2 text-[12px]"><span className="text-ink-700">Drafts:</span>{data.drafts.map((d) => (
          <span key={d.id} className="flex items-center gap-1 rounded-sm border border-hair px-1.5 py-0.5">{d.name}
            <button className="text-[#0F6CBD] hover:underline" onClick={() => { setResult({ cells: d.rows.map((x) => ({ sectionId: x.section_id, day: x.day, period: x.period, subjectId: x.subject_id, staffId: x.staff_id, groupId: x.group_id, room: x.room, extras: x.extras.map((e) => ({ subjectId: e.subject_id, staffId: e.staff_id })) })),
              unplaced: [], attempts: 0, placed: d.rows.length, wanted: d.rows.length, sectionIds: d.section_ids, kept: [] }); setView(d.section_ids[0] ?? null); }}>open</button>
            {canEdit && <button className="text-ink-500 hover:underline" onClick={() => start(async () => { await deleteDraft(d.id); router.refresh(); })}>remove</button>}</span>))}</div>}
        {result && <div className="space-y-3">
          <p className={result.unplaced.length ? "font-semibold text-down" : "font-semibold text-up"}>{result.placed} of {result.wanted} lessons placed{result.unplaced.length ? "" : ", every lesson fits"}.</p>
          {result.unplaced.length > 0 && <ul className="list-disc pl-5 text-ink-700">{result.unplaced.slice(0, 30).map((u, i) => <li key={i}>{secLabel.get(u.sectionId)}: {u.groupId ? groupLabel.get(u.groupId) : subjFull.get(u.subjectId)}, {u.count} period{u.count === 1 ? "" : "s"} not placed. {u.reason}</li>)}</ul>}
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Section to preview" className="h-9 w-48" value={view ?? ""} onChange={(e) => { setView(Number(e.target.value)); setPick(null); }}>{gen.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
            <span className="text-ink-700">Click two lessons to</span>
            <button onClick={() => setMode("swap")} className={`h-8 rounded-sm border px-2 text-[12px] ${toggleCls(mode === "swap")}`}>swap them</button>
            <button onClick={() => setMode("lock")} className={`h-8 rounded-sm border px-2 text-[12px] ${toggleCls(mode === "lock")}`}>lock lessons for the next try</button>
            <Button size="sm" variant="subtle" onClick={() => view != null && void downloadPdf(printOne(view))}>Print this class</Button>
            <Button size="sm" variant="subtle" onClick={() => void downloadPdfBook(gen.map((s) => printOne(s.id)), "Class timetables")}>Print all classes</Button>
            <Button size="sm" variant="subtle" onClick={() => { const ts = [...new Set(allCells.flatMap((c) => teachers(c)))].sort((a, b) => (tName.get(a) ?? "").localeCompare(tName.get(b) ?? "")); void downloadPdfBook(ts.map(printTeacher), "Teacher timetables"); }}>Print teachers</Button>
          </div>
          {view != null && <div className="overflow-x-auto"><table className="border-collapse text-[12px]">
            <thead><tr><th />{data.periods.map((per) => <th key={per.no} className={`px-1 py-1 font-medium ${per.isBreak ? "text-ink-400" : "text-ink-500"}`}>{per.label || per.no}</th>)}</tr></thead>
            <tbody>{DAYS.filter((d) => data.rules.days.includes(d.n)).map((d) => { const m = cellsOf(view); return (
              <tr key={d.n}><td className="pr-2 text-ink-700">{d.short}</td>{data.periods.map((per) => { const c = m.get(`${d.n}-${per.no}`);
                const isLocked = locked.has(`${view}|${d.n}|${per.no}`), isPick = pick?.sec === view && pick.d === d.n && pick.p === per.no;
                if (per.isBreak) return <td key={per.no} className="h-11 w-24 border border-hair bg-panel" />;
                return <td key={per.no} className={`h-11 w-24 cursor-pointer border px-1 align-top ${isPick ? "border-[#0F6CBD] bg-[#EBF3FC]" : "border-hair"} ${c?.kept ? "bg-[#F5F9FE]" : "bg-white"}`}
                  onClick={() => click(view, d.n, per.no)} aria-label={`${d.long} ${per.label || per.no}: ${label(c) || "free"}`}>
                  {c ? <><div className="font-medium">{label(c)}{isLocked ? " (locked)" : ""}</div><div className="truncate text-ink-500">{teachers(c).map((t) => tName.get(t) ?? "").join(", ") || "no teacher"}</div>{c.room && <div className="truncate text-ink-400">{c.room}</div>}</> : null}</td>; })}</tr>); })}</tbody></table></div>}
          {canEdit && <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-48" aria-label="Draft name" placeholder="Draft name" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            <Button size="sm" variant="subtle" disabled={pending || !draftName.trim()} onClick={() => start(async () => { const r = await saveDraft(data.yearId, draftName, result.sectionIds, rows()); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); if (r.ok) { setDraftName(""); router.refresh(); } })}>Keep as a draft</Button>
          </div>}
          {canEdit && (confirm ? <div className="flex flex-wrap items-center gap-2 rounded-sm border border-down bg-white px-3 py-2">
            <span>Replace {replacing} lesson{replacing === 1 ? "" : "s"} in {gen.length} section{gen.length === 1 ? "" : "s"}{result.unplaced.length ? `; ${result.unplaced.reduce((a, u) => a + u.count, 0)} periods are not placed` : ""}?</span>
            <Button disabled={pending} onClick={() => start(async () => { const r = await saveGenerated(data.yearId, result.sectionIds, rows()); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); setConfirm(false); if (r.ok) router.refresh(); })}>Yes, save</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </div> : <Button disabled={pending} onClick={() => setConfirm(true)}>Save this timetable</Button>)}
        </div>}
        <Note m={msg} />
      </CardBody>
    </Card>
  );
}
