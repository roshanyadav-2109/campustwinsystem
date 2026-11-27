"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { addUsualTitles, saveTitle, saveUnit, setDepartmentUnit, setUnitParent, assignPosition, endPosition } from "@/app/dashboard/settings/positions/actions";

export type TitleRow = { id: number; name: string; access_type: string; scope_level: string; active: boolean; sort: number };
export type UnitRow = { id: number; code: string; name: string; kind: string; parent_id?: number | null };
export type PositionRow = { id: number; staff_id: number; title_id: number; unit_id: number | null; department_id: number | null; programme_id: number | null; starts_on: string; ends_on: string | null; acting: boolean };

// What each kind of role will be able to do (access follows the type, never the name).
export const TYPE_LABEL: Record<string, string> = {
  governing: "Governing (view only)", head: "Head of institution", deputy_head: "Deputy head", registrar: "Registrar / administration",
  finance_head: "Finance head", student_affairs: "Student affairs", exams_head: "Examinations head", exams_deputy: "Exam deputy",
  exams_staff: "Exam section staff", confidential: "Exam confidential section", evaluator: "Evaluator", moderator: "Moderator / scrutiniser",
  exam_centre: "Exam-centre staff", revaluation: "Revaluation", dean: "Dean", dept_head: "Department head", programme_coord: "Programme coordinator",
  faculty: "Faculty", advisor: "Advisor / mentor", office_staff: "Office staff", service: "Service (hostel, library...)",
};
const LEVEL_LABEL: Record<string, string> = { university: "Whole university", campus: "This campus / college", faculty: "A faculty or school", department: "A department", programme: "A programme" };
const KIND_LABEL: Record<string, string> = { faculty: "Faculty", school: "School", institute: "Institute", centre: "Centre" };
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const day = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) { after?.(); router.refresh(); }
  });
  return { msg, pending, run };
}
function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}

function TitleEditor({ t, canEdit }: { t: TitleRow | null; canEdit: boolean }) {
  const [name, setName] = useState(t?.name ?? "");
  const [type, setType] = useState(t?.access_type ?? "dept_head");
  const [level, setLevel] = useState(t?.scope_level ?? "department");
  const [active, setActive] = useState(t?.active ?? true);
  const { msg, pending, run } = useAct();
  const dirty = !t || name !== t.name || type !== t.access_type || level !== t.scope_level || active !== t.active;
  return (
    <tr className="border-t border-hair">
      <td className="px-4 py-1.5"><Input className="h-8 text-[13px]" aria-label={t ? `Title ${t.name}` : "New title"} placeholder="New title, for example Dean of Research" disabled={!canEdit} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="px-2 py-1.5"><Select className="h-8 text-[13px]" aria-label={`Type of ${t?.name ?? "new title"}`} disabled={!canEdit} value={type} onChange={(e) => setType(e.target.value)}>
        {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></td>
      <td className="px-2 py-1.5"><Select className="h-8 text-[13px]" aria-label={`Where ${t?.name ?? "new title"} applies`} disabled={!canEdit} value={level} onChange={(e) => setLevel(e.target.value)}>
        {Object.entries(LEVEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></td>
      <td className="px-2 py-1.5 text-center">{t && <input type="checkbox" aria-label={`${t.name} in use`} disabled={!canEdit} checked={active} onChange={(e) => setActive(e.target.checked)} />}</td>
      <td className="px-4 py-1.5 text-right">{canEdit && dirty && <Button size="sm" disabled={pending || name.trim().length < 2} onClick={() => run(() => saveTitle({ id: t?.id, name, accessType: type, scopeLevel: level, active }), () => { if (!t) setName(""); })}>{t ? "Save" : "Add"}</Button>} <Msg m={msg} /></td>
    </tr>
  );
}

function Units({ units, departments, canEdit }: { units: UnitRow[]; departments: { id: number; code: string; name: string; unit_id: number | null }[]; canEdit: boolean }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("faculty");
  const { msg, pending, run } = useAct();
  return (
    <Card>
      <CardHeader title="Faculties and schools" action={<Msg m={msg} />} />
      <CardBody className="space-y-3 text-[13px]">
        <p className="text-[12px] text-ink-500">Group departments under a faculty or school, and groups under larger ones (for example a CS and EC group under the School of Engineering). A Dean or Director covers everything below them.</p>
        <ul className="space-y-1">{units.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2"><b>{u.name}</b> <span className="text-ink-500">{u.code} · {KIND_LABEL[u.kind]}</span>
            <Select className="ml-auto h-8 text-[12px]" aria-label={`Above ${u.name}`} disabled={!canEdit || pending} value={u.parent_id ?? ""}
              onChange={(e) => run(() => setUnitParent(u.id, e.target.value ? Number(e.target.value) : null))}>
              <option value="">Directly under the institution</option>{units.filter((x) => x.id !== u.id).map((x) => <option key={x.id} value={x.id}>Under {x.name}</option>)}</Select></li>))}</ul>
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <Input className="h-8 w-24 text-[13px]" aria-label="Faculty code" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
            <Input className="h-8 w-72 text-[13px]" aria-label="Faculty name" placeholder="Name, for example Faculty of Science" value={name} onChange={(e) => setName(e.target.value)} />
            <Select className="h-8 text-[13px]" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            <Button size="sm" disabled={pending} onClick={() => run(() => saveUnit({ code, name, kind }), () => { setCode(""); setName(""); })}>Add</Button>
          </div>
        )}
        {departments.length > 0 && (
          <table className="w-full"><tbody>{departments.map((d) => (
            <tr key={d.id} className="border-t border-hair"><td className="py-1.5">{d.name} <span className="text-ink-500">{d.code}</span></td>
              <td className="py-1.5 text-right"><Select className="h-8 text-[13px]" aria-label={`Faculty of ${d.name}`} disabled={!canEdit || pending} value={d.unit_id ?? ""}
                onChange={(e) => run(() => setDepartmentUnit(d.id, e.target.value ? Number(e.target.value) : null))}>
                <option value="">No faculty</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></td></tr>))}</tbody></table>
        )}
      </CardBody>
    </Card>
  );
}

export function PositionsAdmin({ titles, units, departments, programmes, staff, positions, log, canEdit }: {
  titles: TitleRow[]; units: UnitRow[]; departments: { id: number; code: string; name: string; unit_id: number | null }[]; programmes: { id: number; code: string; name: string }[];
  staff: { id: number; name: string }[]; positions: PositionRow[]; log: { at: string; action: string; detail: string; staff: { full_name: string } | null; by: { full_name: string } | null }[]; canEdit: boolean;
}) {
  const [who, setWho] = useState(0);
  const [titleId, setTitleId] = useState(0);
  const [place, setPlace] = useState(0);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState("");
  const [acting, setActing] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const top = useAct();
  const assign = useAct();
  const title = titles.find((t) => t.id === titleId);
  const places = title?.scope_level === "faculty" ? units.map((u) => ({ id: u.id, name: u.name })) : title?.scope_level === "department" ? departments : title?.scope_level === "programme" ? programmes : [];
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const titleOf = new Map(titles.map((t) => [t.id, t]));
  const placeOf = (p: PositionRow) => (p.unit_id ? units.find((u) => u.id === p.unit_id)?.name : p.department_id ? departments.find((d) => d.id === p.department_id)?.name : p.programme_id ? programmes.find((g) => g.id === p.programme_id)?.name : null);
  const t0 = today();
  const current = positions.filter((p) => p.starts_on <= t0 && (!p.ends_on || p.ends_on >= t0) || p.starts_on > t0);
  const shown = showEnded ? positions : current;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={`People in positions (${current.length})`} action={<Msg m={assign.msg} />} />
        <CardBody className="space-y-3 p-0">
          {canEdit && titles.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 border-b border-hair px-4 py-3">
              <Select className="h-9 text-[13px]" aria-label="Person" value={who} onChange={(e) => setWho(Number(e.target.value))}><option value={0}>Person…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              <Select className="h-9 text-[13px]" aria-label="Title" value={titleId} onChange={(e) => { setTitleId(Number(e.target.value)); setPlace(0); }}><option value={0}>Title…</option>{titles.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
              {places.length > 0 || (title && ["faculty", "department", "programme"].includes(title.scope_level)) ? (
                <Select className="h-9 text-[13px]" aria-label="Where" value={place} onChange={(e) => setPlace(Number(e.target.value))}><option value={0}>{LEVEL_LABEL[title?.scope_level ?? ""]}…</option>{places.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
              ) : null}
              <label className="text-[12px] text-ink-700">From<Input type="date" className="mt-0.5 h-9 text-[13px]" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="text-[12px] text-ink-700">Until (optional)<Input type="date" className="mt-0.5 h-9 text-[13px]" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700"><input type="checkbox" checked={acting} onChange={(e) => setActing(e.target.checked)} />Acting / in charge</label>
              <Button disabled={assign.pending} onClick={() => assign.run(() => assignPosition({ staffId: who, titleId, from, to, acting,
                unitId: title?.scope_level === "faculty" ? place || null : null, departmentId: title?.scope_level === "department" ? place || null : null, programmeId: title?.scope_level === "programme" ? place || null : null }),
                () => { setWho(0); setActing(false); setTo(""); })}>Assign</Button>
            </div>
          )}
          {shown.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">Nobody holds a position yet.</p> : (
            <table className="w-full text-[13px]">
              <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Person</th><th className="px-4 py-2 font-medium">Position</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Since</th><th /></tr></thead>
              <tbody>{shown.map((p) => {
                const t = titleOf.get(p.title_id); const ended = !!p.ends_on && p.ends_on < t0;
                return (
                  <tr key={p.id} className={`border-t border-hair ${ended ? "text-ink-500" : ""}`}>
                    <td className="px-4 py-1.5 font-medium">{staffName.get(p.staff_id)}</td>
                    <td className="px-4 py-1.5">{p.acting ? "Acting " : ""}{t?.name}{placeOf(p) ? `, ${placeOf(p)}` : ""}</td>
                    <td className="px-4 py-1.5 text-ink-500">{t ? TYPE_LABEL[t.access_type] : ""}</td>
                    <td className="px-4 py-1.5 tabular">{day(p.starts_on)}{p.ends_on ? ` to ${day(p.ends_on)}` : ""}</td>
                    <td className="px-4 py-1.5 text-right">{canEdit && !ended && <EndButton id={p.id} label={`${staffName.get(p.staff_id)}, ${t?.name}`} />}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          <div className="px-4 pb-3"><label className="flex items-center gap-1.5 text-[12px] text-ink-700"><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />Show positions that have ended</label></div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Titles (${titles.length})`} action={<Msg m={top.msg} />} />
        <CardBody className="space-y-2 p-0">
          {titles.length === 0 && canEdit && (
            <div className="flex items-center gap-3 px-4 pt-3"><p className="text-[13px] text-ink-700">Start from the usual titles for your institution and rename any of them.</p>
              <Button size="sm" disabled={top.pending} onClick={() => top.run(() => addUsualTitles())}>Add the usual titles</Button></div>
          )}
          <p className="px-4 pt-3 text-[12px] text-ink-500">The name is yours. The type decides what the person will be able to do, and where it applies limits it to the whole university, this campus, a faculty, a department or a programme.</p>
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Title</th><th className="px-2 py-2 font-medium">Type</th><th className="px-2 py-2 font-medium">Applies to</th><th className="px-2 py-2 text-center font-medium">In use</th><th /></tr></thead>
            <tbody>{titles.map((t) => <TitleEditor key={`${t.id}-${t.name}-${t.access_type}-${t.scope_level}-${t.active}`} t={t} canEdit={canEdit} />)}{canEdit && <TitleEditor key="new" t={null} canEdit />}</tbody>
          </table>
        </CardBody>
      </Card>

      <Units units={units} departments={departments} canEdit={canEdit} />

      {log.length > 0 && (
        <Card>
          <CardHeader title="Recent changes" />
          <CardBody className="p-0">
            <ul className="text-[13px]">{log.map((l, i) => (
              <li key={i} className="border-t border-hair px-4 py-1.5 first:border-t-0"><span className="text-ink-500">{new Date(l.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span> {l.staff?.full_name ? <b>{l.staff.full_name}</b> : null} {l.action}: {l.detail}{l.by?.full_name ? <span className="text-ink-500">, by {l.by.full_name}</span> : null}</li>))}</ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function EndButton({ id, label }: { id: number; label: string }) {
  const { msg, pending, run } = useAct();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="ghost" aria-label={`End ${label}`} disabled={pending} onClick={() => run(() => endPosition(id))}>End</Button><Msg m={msg} /></span>;
}
