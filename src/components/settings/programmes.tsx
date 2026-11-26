"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { addDepartment, addProgramme, addCourse, removeFromProgramme } from "@/app/dashboard/settings/programmes/actions";

export type DeptView = { id: number; code: string; name: string };
export type ProgrammeView = { id: number; department_id: number | null; code: string; name: string; level: string; regulation: string; years: number; semesters: number; total_credits: number | null;
  courses: { id: number; semester_no: number; elective_group: string | null; course: { code: string; name: string; kind: string; lecture: number; tutorial: number; practical: number; credits: number } | null }[] };

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
  return <span role={m.ok ? "status" : "alert"} className={`text-[12px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}
const semCredits = (p: ProgrammeView, sem: number) => {
  const list = p.courses.filter((c) => c.semester_no === sem);
  const core = list.filter((c) => !c.elective_group).reduce((n, c) => n + Number(c.course?.credits ?? 0), 0);
  const groups = new Map<string, number>();
  for (const c of list.filter((x) => x.elective_group)) groups.set(c.elective_group!, Math.max(groups.get(c.elective_group!) ?? 0, Number(c.course?.credits ?? 0)));
  return core + [...groups.values()].reduce((a, b) => a + b, 0);
};

function Programme({ p, canEdit }: { p: ProgrammeView; canEdit: boolean }) {
  const uid = useId();
  const blank = { semester: "1", code: "", name: "", kind: "core", l: "3", t: "1", p: "0", credits: "4", group: "" };
  const [c, setC] = useState(blank);
  const [open, setOpen] = useState(false);
  const { msg, pending, run } = useAct();
  const total = Array.from({ length: p.semesters }, (_, i) => semCredits(p, i + 1)).reduce((a, b) => a + b, 0);
  return (
    <Card>
      <CardHeader title={`${p.name} (${p.code}, ${p.regulation})`} action={<span className="text-[12px] text-ink-500">{p.level.toUpperCase()} · {p.years} years · {p.semesters} semesters · {total} credits{p.total_credits ? ` of ${Number(p.total_credits)}` : ""}</span>} />
      <CardBody className="space-y-3">
        {Array.from({ length: p.semesters }, (_, i) => i + 1).map((sem) => {
          const list = p.courses.filter((x) => x.semester_no === sem);
          return (
            <div key={sem}>
              <p className="mb-1 text-[13px] font-medium text-ink-900">Semester {sem} <span className="font-normal text-ink-500">· {semCredits(p, sem)} credits</span></p>
              {list.length === 0 ? <p className="text-[12px] text-ink-500">No courses yet.</p> : (
                <table className="w-full text-[12px]"><tbody>{list.map((x) => (
                  <tr key={x.id} className="border-t border-hair first:border-t-0">
                    <td className="w-24 py-1 font-medium">{x.course?.code}</td><td className="py-1">{x.course?.name}{x.elective_group ? <span className="ml-1 text-ink-500">(choice: {x.elective_group})</span> : null}</td>
                    <td className="w-20 py-1 text-ink-700">{x.course?.kind}</td><td className="w-20 py-1 tabular text-ink-700">{x.course?.lecture}-{x.course?.tutorial}-{x.course?.practical}</td>
                    <td className="w-16 py-1 text-right tabular">{Number(x.course?.credits ?? 0)} cr</td>
                    {canEdit && <td className="w-20 py-1 text-right"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeFromProgramme(x.id))}>Remove</Button></td>}
                  </tr>))}</tbody></table>
              )}
            </div>
          );
        })}
        {canEdit && (open ? (
          <div className="grid items-end gap-2 border-t border-hair pt-3 sm:grid-cols-5 xl:grid-cols-10">
            <Field label="Semester" htmlFor={`${uid}-s`}><Select id={`${uid}-s`} value={c.semester} onChange={(e) => setC({ ...c, semester: e.target.value })}>{Array.from({ length: p.semesters }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select></Field>
            <Field label="Code" htmlFor={`${uid}-c`}><Input id={`${uid}-c`} value={c.code} onChange={(e) => setC({ ...c, code: e.target.value })} /></Field>
            <Field label="Course name" htmlFor={`${uid}-n`}><Input id={`${uid}-n`} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
            <Field label="Type" htmlFor={`${uid}-k`}><Select id={`${uid}-k`} value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value })}>{["core", "elective", "lab", "project", "aec", "sec", "vac"].map((k) => <option key={k}>{k}</option>)}</Select></Field>
            <Field label="L" htmlFor={`${uid}-l`}><Input id={`${uid}-l`} inputMode="numeric" value={c.l} onChange={(e) => setC({ ...c, l: e.target.value })} /></Field>
            <Field label="T" htmlFor={`${uid}-t`}><Input id={`${uid}-t`} inputMode="numeric" value={c.t} onChange={(e) => setC({ ...c, t: e.target.value })} /></Field>
            <Field label="P" htmlFor={`${uid}-p`}><Input id={`${uid}-p`} inputMode="numeric" value={c.p} onChange={(e) => setC({ ...c, p: e.target.value })} /></Field>
            <Field label="Credits" htmlFor={`${uid}-cr`}><Input id={`${uid}-cr`} inputMode="decimal" value={c.credits} onChange={(e) => setC({ ...c, credits: e.target.value })} /></Field>
            <Field label="Choice group" htmlFor={`${uid}-g`}><Input id={`${uid}-g`} placeholder="for electives" value={c.group} onChange={(e) => setC({ ...c, group: e.target.value })} /></Field>
            <Button disabled={pending} onClick={() => run(() => addCourse({ programmeId: p.id, ...c }), () => setC({ ...blank, semester: c.semester }))}>Add course</Button>
            <div className="col-span-full"><Msg m={msg} /></div>
          </div>
        ) : <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>Add a course</Button>)}
      </CardBody>
    </Card>
  );
}

export function ProgrammesAdmin({ departments, programmes, canEdit }: { departments: DeptView[]; programmes: ProgrammeView[]; canEdit: boolean }) {
  const uid = useId();
  const [d, setD] = useState({ code: "", name: "" });
  const [p, setP] = useState<{ departmentId: number | null; code: string; name: string; level: string; regulation: string; years: string; semesters: string; credits: string }>({ departmentId: departments[0]?.id ?? null, code: "", name: "", level: "ug", regulation: "R2024", years: "3", semesters: "6", credits: "" });
  const { msg, pending, run } = useAct();
  return (
    <div className="space-y-4">
      {departments.map((dep) => {
        const list = programmes.filter((x) => x.department_id === dep.id);
        if (!list.length) return null;
        return <section key={dep.id} className="space-y-3"><h2 className="text-[15px] font-semibold text-ink-900">{dep.name} <span className="font-normal text-ink-500">({dep.code})</span></h2>{list.map((x) => <Programme key={x.id} p={x} canEdit={canEdit} />)}</section>;
      })}
      {programmes.filter((x) => !x.department_id).map((x) => <Programme key={x.id} p={x} canEdit={canEdit} />)}
      {canEdit && (
        <Card>
          <CardHeader title="Add a department or programme" action={<Msg m={msg} />} />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Department code" htmlFor={`${uid}-dc`}><Input id={`${uid}-dc`} className="w-28" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} /></Field>
              <Field label="Department name" htmlFor={`${uid}-dn`}><Input id={`${uid}-dn`} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
              <Button variant="subtle" disabled={pending} onClick={() => run(() => addDepartment(d.code, d.name), () => setD({ code: "", name: "" }))}>Add department</Button>
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t border-hair pt-3">
              <Field label="Department" htmlFor={`${uid}-pd`}><Select id={`${uid}-pd`} value={p.departmentId ?? ""} onChange={(e) => setP({ ...p, departmentId: e.target.value ? Number(e.target.value) : null })}><option value="">None</option>{departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
              <Field label="Programme code" htmlFor={`${uid}-pc`}><Input id={`${uid}-pc`} className="w-28" value={p.code} onChange={(e) => setP({ ...p, code: e.target.value })} /></Field>
              <Field label="Programme name" htmlFor={`${uid}-pn`}><Input id={`${uid}-pn`} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
              <Field label="Level" htmlFor={`${uid}-pl`}><Select id={`${uid}-pl`} value={p.level} onChange={(e) => setP({ ...p, level: e.target.value })}><option value="diploma">Diploma</option><option value="ug">UG</option><option value="pg">PG</option><option value="phd">PhD</option></Select></Field>
              <Field label="Regulation" htmlFor={`${uid}-pr`}><Input id={`${uid}-pr`} className="w-24" value={p.regulation} onChange={(e) => setP({ ...p, regulation: e.target.value })} /></Field>
              <Field label="Years" htmlFor={`${uid}-py`}><Input id={`${uid}-py`} className="w-16" value={p.years} onChange={(e) => setP({ ...p, years: e.target.value })} /></Field>
              <Field label="Semesters" htmlFor={`${uid}-ps`}><Input id={`${uid}-ps`} className="w-16" value={p.semesters} onChange={(e) => setP({ ...p, semesters: e.target.value })} /></Field>
              <Field label="Total credits" htmlFor={`${uid}-pt`}><Input id={`${uid}-pt`} className="w-20" value={p.credits} onChange={(e) => setP({ ...p, credits: e.target.value })} /></Field>
              <Button disabled={pending} onClick={() => run(() => addProgramme(p), () => setP({ ...p, code: "", name: "", credits: "" }))}>Add programme</Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
