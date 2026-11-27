"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { transferPosition } from "@/app/dashboard/settings/positions/actions";

export type Chart = {
  units: { id: number; parent_id: number | null; name: string; kind: string; code: string }[];
  departments: { id: number; unit_id: number | null; name: string; code: string }[];
  programmes: { id: number; department_id: number | null; name: string }[];
  positions: { id: number; title: string; type: string; level: string; sort: number; staff_id: number; holder: string; acting: boolean; since: string; until: string | null;
    unit_id: number | null; department_id: number | null; programme_id: number | null; elsewhere: boolean }[];
};
type Pos = Chart["positions"][number];
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
// the order people expect to read a chart in
const RANK: Record<string, number> = { governing: 0, head: 1, deputy_head: 2, registrar: 3, exams_head: 4, finance_head: 5, student_affairs: 6, dean: 7, dept_head: 8, programme_coord: 9 };

function Holder({ p, staff, canEdit }: { p: Pos; staff: { id: number; name: string }[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(0);
  const [on, setOn] = useState(today());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-hair bg-white px-2.5 py-1.5 text-[13px]">
      <span className="font-semibold text-ink-900">{p.title}</span>
      <span className="text-ink-700">{p.acting ? "(acting) " : ""}{p.holder}</span>
      {p.elsewhere && <span className="text-[11px] text-ink-500">university-wide</span>}
      {canEdit && !p.elsewhere && !open && <Button size="sm" variant="ghost" aria-label={`Transfer ${p.title}`} onClick={() => setOpen(true)}>Transfer</Button>}
      {open && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Select className="h-8 text-[12px]" aria-label={`New holder of ${p.title}`} value={to} onChange={(e) => setTo(Number(e.target.value))}>
            <option value={0}>Hand over to…</option>{staff.filter((s) => s.id !== p.staff_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Input type="date" className="h-8 text-[12px]" aria-label="From" value={on} onChange={(e) => setOn(e.target.value)} />
          <Button size="sm" disabled={pending || !to} onClick={() => start(async () => {
            const r = await transferPosition(p.id, to, on); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) { setOpen(false); router.refresh(); }
          })}>Hand over</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </span>
      )}
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
  const Dept = ({ d }: { d: Chart["departments"][number] }) => (
    <li className="space-y-1.5 border-l-2 border-hair pl-3">
      <div className="text-[13px] font-medium text-ink-900">{d.name}</div>
      <Positions list={ofDept(d.id)} staff={staff} canEdit={canEdit} empty="No Head of Department yet." />
      {chart.programmes.filter((g) => g.department_id === d.id && ofProg(g.id).length).map((g) => (
        <div key={g.id} className="pl-3"><div className="text-[12px] text-ink-700">{g.name}</div><Positions list={ofProg(g.id)} staff={staff} canEdit={canEdit} /></div>
      ))}
    </li>
  );
  const Unit = ({ u, depth }: { u: Chart["units"][number]; depth: number }) => (
    <li className="space-y-2 border-l-2 border-[#0F6CBD]/30 pl-3">
      <div className="text-[14px] font-semibold text-ink-900">{u.name}</div>
      <Positions list={ofUnit(u.id)} staff={staff} canEdit={canEdit} empty="No Dean or Director yet." />
      <ul className="space-y-2">
        {depth < 6 && chart.units.filter((c) => c.parent_id === u.id).map((c) => <Unit key={c.id} u={c} depth={depth + 1} />)}
        {chart.departments.filter((d) => d.unit_id === u.id).map((d) => <Dept key={d.id} d={d} />)}
      </ul>
    </li>
  );
  const loose = chart.departments.filter((d) => !d.unit_id);
  return (
    <Card>
      <CardHeader title="Hierarchy" />
      <CardBody className="space-y-3">
        <p className="text-[12px] text-ink-500">Who holds which position, from the top down. Hand a position over with Transfer: the new person starts on the date given and the previous holder ends the day before.</p>
        <Positions list={top} staff={staff} canEdit={canEdit} empty="No head of institution yet." />
        <ul className="space-y-3">
          {chart.units.filter((u) => !u.parent_id).map((u) => <Unit key={u.id} u={u} depth={0} />)}
          {loose.map((d) => <Dept key={d.id} d={d} />)}
        </ul>
      </CardBody>
    </Card>
  );
}
