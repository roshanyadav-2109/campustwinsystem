"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { candidates, assign, unassign, type Candidate } from "@/app/dashboard/substitutions/actions";

export type Need = { slot_id: number; period_no: number; period_label: string | null; start_time: string | null; end_time: string | null; section_label: string; subject: string | null;
  absent_staff_id: number; absent_name: string; substitute_id: number | null; substitute_name: string | null; substitution_id: number | null };

function Lesson({ n, date }: { n: Need; date: string }) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState<number | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const when = `${n.period_label ?? `Period ${n.period_no}`}${n.start_time ? ` (${n.start_time.slice(0, 5)}${n.end_time ? `-${n.end_time.slice(0, 5)}` : ""})` : ""}`;
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-2 text-[13px] last:border-b-0">
      <span className="w-40 shrink-0 text-ink-700">{when}</span>
      <span className="w-48 shrink-0 font-medium text-ink-900">{n.section_label}{n.subject ? `, ${n.subject}` : ""}</span>
      {n.substitute_id ? (
        <>
          <span className="text-up">Taken by {n.substitute_name}</span>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await unassign(n.substitution_id!); setMsg(r.ok ? null : { ok: false, text: r.error }); router.refresh(); })}>Change</Button>
        </>
      ) : list === null ? (
        <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const r = await candidates(date, n.slot_id); if (r.ok) setList(r.list); else setMsg({ ok: false, text: r.error }); })}>Find a substitute</Button>
      ) : list.length === 0 ? (
        <span className="text-down">No teacher is free in this period.</span>
      ) : (
        <>
          <Select className="h-8 w-72 text-[13px]" aria-label={`Substitute for ${n.section_label} ${when}`} value={pick} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose a free teacher</option>
            {list.map((c) => <option key={c.staff_id} value={c.staff_id}>{c.full_name}{c.teaches_subject ? " · teaches the subject" : ""}{c.teaches_section ? " · teaches this class" : ""} · {c.lessons_today} lessons today</option>)}
          </Select>
          <Button size="sm" disabled={pending || pick === ""} onClick={() => start(async () => { const r = await assign(date, n.slot_id, pick as number); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>Assign</Button>
        </>
      )}
      {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[12px] ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
    </li>
  );
}

export function SubstitutionBoard({ date, needs }: { date: string; needs: Need[] }) {
  const router = useRouter();
  const byTeacher = new Map<number, Need[]>();
  for (const n of needs) byTeacher.set(n.absent_staff_id, [...(byTeacher.get(n.absent_staff_id) ?? []), n]);
  const open = needs.filter((n) => !n.substitute_id).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" className="h-9 w-44 text-[13px]" aria-label="Date" value={date} onChange={(e) => router.push(`?date=${e.target.value}`)} />
        <span className="text-[13px] text-ink-700">{needs.length === 0 ? "No lessons need a substitute on this day." : `${needs.length} lessons need a substitute; ${open} still open.`}</span>
      </div>
      {[...byTeacher.entries()].map(([id, list]) => (
        <Card key={id}>
          <CardHeader title={list[0].absent_name} action={<span className="text-[12px] text-ink-500">{list.length} lessons</span>} />
          <CardBody className="p-0"><ul>{list.map((n) => <Lesson key={n.slot_id} n={n} date={date} />)}</ul></CardBody>
        </Card>
      ))}
    </div>
  );
}
