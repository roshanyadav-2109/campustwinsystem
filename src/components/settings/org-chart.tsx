"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { transferPosition, assignPosition } from "@/app/dashboard/settings/positions/actions";
import { downloadPdf } from "@/lib/pdf";

export type Chart = {
  units: { id: number; parent_id: number | null; name: string; kind: string; code: string }[];
  departments: { id: number; unit_id: number | null; name: string; code: string }[];
  programmes: { id: number; department_id: number | null; name: string }[];
  titles: { id: number; name: string; type: string; level: string; sort: number }[];
  positions: { id: number; title_id: number; title: string; type: string; level: string; sort: number; staff_id: number; holder: string; acting: boolean; since: string; until: string | null;
    unit_id: number | null; department_id: number | null; programme_id: number | null; elsewhere: boolean }[];
};
type Pos = Chart["positions"][number];
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
// the order people expect to read a chart in
const RANK: Record<string, number> = { governing: 0, head: 1, deputy_head: 2, registrar: 3, exams_head: 4, finance_head: 5, student_affairs: 6, dean: 7, dept_head: 8, programme_coord: 9 };

function Holder({ p, staff, canEdit }: { p: Pos; staff: { id: number; name: string }[]; canEdit: boolean }) {
  const [open, setOpen] = useState<"" | "transfer" | "acting">("");
  const [to, setTo] = useState(0);
  const [on, setOn] = useState(today());
  const [until, setUntil] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-hair bg-white px-2.5 py-1.5 text-[13px]">
      <span className="font-semibold text-ink-900">{p.title}</span>
      <span className="text-ink-700">{p.acting ? "(acting) " : ""}{p.holder}</span>
      {p.elsewhere && <span className="text-[11px] text-ink-500">university-wide</span>}
      {canEdit && !p.elsewhere && !open && <>
        <Button size="sm" variant="ghost" aria-label={`Transfer ${p.title}`} onClick={() => setOpen("transfer")}>Transfer</Button>
        {!p.acting && <Button size="sm" variant="ghost" aria-label={`Acting cover for ${p.title}`} onClick={() => setOpen("acting")}>Acting cover</Button>}
      </>}
      {open === "acting" && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Select className="h-8 text-[12px]" aria-label={`Acting ${p.title}`} value={to} onChange={(e) => setTo(Number(e.target.value))}>
            <option value={0}>Who covers…</option>{staff.filter((s) => s.id !== p.staff_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Input type="date" className="h-8 text-[12px]" aria-label="From" value={on} onChange={(e) => setOn(e.target.value)} />
          <Input type="date" className="h-8 text-[12px]" aria-label="Until" value={until} onChange={(e) => setUntil(e.target.value)} />
          <Button size="sm" disabled={pending || !to || !until} onClick={() => start(async () => {
            const r = await assignPosition({ staffId: to, titleId: p.title_id, unitId: p.unit_id, departmentId: p.department_id, programmeId: p.programme_id, from: on, to: until, acting: true });
            setMsg(r.ok ? { ok: true, text: "Acting cover set. The holder keeps the position." } : { ok: false, text: r.error ?? "" }); if (r.ok) { setOpen(""); router.refresh(); }
          })}>Set cover</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen("")}>Cancel</Button>
        </span>
      )}
      {open === "transfer" && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Select className="h-8 text-[12px]" aria-label={`New holder of ${p.title}`} value={to} onChange={(e) => setTo(Number(e.target.value))}>
            <option value={0}>Hand over to…</option>{staff.filter((s) => s.id !== p.staff_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Input type="date" className="h-8 text-[12px]" aria-label="From" value={on} onChange={(e) => setOn(e.target.value)} />
          <Button size="sm" disabled={pending || !to} onClick={() => start(async () => {
            const r = await transferPosition(p.id, to, on); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) { setOpen(""); router.refresh(); }
          })}>Hand over</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen("")}>Cancel</Button>
        </span>
      )}
      {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[12px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
    </div>
  );
}

// A position nobody holds: shown as vacant, with Assign.
function Vacant({ title, place, staff, canEdit }: { title: Chart["titles"][number]; place: { unitId?: number; departmentId?: number }; staff: { id: number; name: string }[]; canEdit: boolean }) {
  const [to, setTo] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-dashed border-hair bg-white px-2.5 py-1.5 text-[13px]">
      <span className="font-semibold text-ink-900">{title.name}</span><span className="text-ink-500">Vacant</span>
      {canEdit && <>
        <Select className="h-8 text-[12px]" aria-label={`Assign ${title.name}`} value={to} onChange={(e) => setTo(Number(e.target.value))}>
          <option value={0}>Assign…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Button size="sm" disabled={pending || !to} onClick={() => start(async () => {
          const r = await assignPosition({ staffId: to, titleId: title.id, unitId: place.unitId ?? null, departmentId: place.departmentId ?? null, programmeId: null, from: today(), to: "", acting: false });
          setMsg(r.ok ? { ok: true, text: "Assigned." } : { ok: false, text: r.error ?? "" }); if (r.ok) router.refresh();
        })}>Assign</Button>
      </>}
      {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[12px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
    </div>
  );
}

function Positions({ list, staff, canEdit, empty }: { list: Pos[]; staff: { id: number; name: string }[]; canEdit: boolean; empty?: string }) {
  if (!list.length) return empty ? <p className="text-[12px] text-ink-500">{empty}</p> : null;
  return <div className="flex flex-wrap gap-1.5">{[...list].sort((a, b) => (RANK[a.type] ?? 20) - (RANK[b.type] ?? 20) || a.sort - b.sort).map((p) => <Holder key={p.id} p={p} staff={staff} canEdit={canEdit} />)}</div>;
}

// The institution's hierarchy: university and campus positions at the top,
// then faculties and schools (nested), their departments and programmes.
export function OrgChart({ chart, staff, canEdit }: { chart: Chart; staff: { id: number; name: string }[]; canEdit: boolean }) {
  const top = chart.positions.filter((p) => !p.unit_id && !p.department_id && !p.programme_id && ["governing", "head", "deputy_head", "registrar", "exams_head", "finance_head", "student_affairs", "dean"].includes(p.type));
  const ofUnit = (id: number) => chart.positions.filter((p) => p.unit_id === id);
  const ofDept = (id: number) => chart.positions.filter((p) => p.department_id === id);
  const ofProg = (id: number) => chart.positions.filter((p) => p.programme_id === id);
  const firstTitle = (type: string, level: string) => (chart.titles ?? []).filter((t) => t.type === type && t.level === level).sort((a, b) => a.sort - b.sort)[0];
  const hodTitle = firstTitle("dept_head", "department"), deanTitle = firstTitle("dean", "faculty");
  const Dept = ({ d }: { d: Chart["departments"][number] }) => (
    <li className="space-y-1.5 border-l-2 border-hair pl-3">
      <div className="text-[13px] font-medium text-ink-900">{d.name}</div>
      <Positions list={ofDept(d.id)} staff={staff} canEdit={canEdit} />
      {!ofDept(d.id).some((p) => p.type === "dept_head") && hodTitle && <Vacant title={hodTitle} place={{ departmentId: d.id }} staff={staff} canEdit={canEdit} />}
      {chart.programmes.filter((g) => g.department_id === d.id && ofProg(g.id).length).map((g) => (
        <div key={g.id} className="pl-3"><div className="text-[12px] text-ink-700">{g.name}</div><Positions list={ofProg(g.id)} staff={staff} canEdit={canEdit} /></div>
      ))}
    </li>
  );
  const Unit = ({ u, depth }: { u: Chart["units"][number]; depth: number }) => (
    <li className="space-y-2 border-l-2 border-[#0F6CBD]/30 pl-3">
      <div className="text-[14px] font-semibold text-ink-900">{u.name}</div>
      <Positions list={ofUnit(u.id)} staff={staff} canEdit={canEdit} />
      {!ofUnit(u.id).some((p) => p.type === "dean") && deanTitle && <Vacant title={deanTitle} place={{ unitId: u.id }} staff={staff} canEdit={canEdit} />}
      <ul className="space-y-2">
        {depth < 19 && chart.units.filter((c) => c.parent_id === u.id).map((c) => <Unit key={c.id} u={c} depth={depth + 1} />)}
        {chart.departments.filter((d) => d.unit_id === u.id).map((d) => <Dept key={d.id} d={d} />)}
      </ul>
    </li>
  );
  const loose = chart.departments.filter((d) => !d.unit_id);
  // the chart as a document: every place from the top down, with who holds each position
  const print = () => {
    const lines: string[] = [];
    const held = (f: (p: Pos) => boolean) => chart.positions.filter(f).map((p) => `${p.title}: ${p.holder}${p.acting ? " (acting)" : ""}`).join("; ");
    const topLine = held((p) => top.includes(p)); if (topLine) lines.push(topLine, "");
    const dept = (d: Chart["departments"][number], pad: string) => {
      lines.push(`${pad}${d.name}${held((p) => p.department_id === d.id && !p.programme_id) ? ` - ${held((p) => p.department_id === d.id && !p.programme_id)}` : ""}`);
      for (const g of chart.programmes.filter((x) => x.department_id === d.id)) { const h = held((p) => p.programme_id === g.id); if (h) lines.push(`${pad}    ${g.name} - ${h}`); }
    };
    const unit = (u: Chart["units"][number], depth: number) => {
      const pad = "    ".repeat(depth);
      lines.push(`${pad}${u.name}${held((p) => p.unit_id === u.id) ? ` - ${held((p) => p.unit_id === u.id)}` : ""}`);
      if (depth < 19) chart.units.filter((c) => c.parent_id === u.id).forEach((c) => unit(c, depth + 1));
      chart.departments.filter((d) => d.unit_id === u.id).forEach((d) => dept(d, pad + "    "));
    };
    chart.units.filter((u) => !u.parent_id).forEach((u) => unit(u, 0));
    loose.forEach((d) => dept(d, ""));
    void downloadPdf({ filename: "Organisation chart", title: "Organisation chart", meta: [new Date().toISOString().slice(0, 10).split("-").reverse().join("/")], blocks: [{ kind: "text", lines }] });
  };
  return (
    <Card>
      <CardHeader title="Hierarchy" action={<Button size="sm" variant="subtle" onClick={print}>Print the chart</Button>} />
      <CardBody className="space-y-3">
        <p className="text-[12px] text-ink-500">Who holds which position, from the top down. Hand a position over with Transfer: the new person starts on the date given and the previous holder ends the day before.</p>
        <Positions list={top} staff={staff} canEdit={canEdit} />
        <div className="flex flex-wrap gap-1.5">{(chart.titles ?? []).filter((t) => ["head", "registrar", "exams_head"].includes(t.type) && ["campus", "university"].includes(t.level) && !top.some((p) => p.type === t.type))
          .filter((t, i, all) => all.findIndex((x) => x.type === t.type) === i).map((t) => <Vacant key={t.id} title={t} place={{}} staff={staff} canEdit={canEdit && t.level === "campus"} />)}</div>
        <ul className="space-y-3">
          {chart.units.filter((u) => !u.parent_id).map((u) => <Unit key={u.id} u={u} depth={0} />)}
          {loose.map((d) => <Dept key={d.id} d={d} />)}
        </ul>
      </CardBody>
    </Card>
  );
}
