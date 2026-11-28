"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { campusExams, copyExam } from "@/app/dashboard/university/actions";

// A common exam: one campus's timetable copied to the others (each campus checks and publishes its copy).
export function CommonExam({ campuses }: { campuses: { id: number; name: string }[] }) {
  const [from, setFrom] = useState(campuses[0]?.id ?? 0);
  const [exams, setExams] = useState<{ id: number; name: string; papers: number }[] | null>(null);
  const [exam, setExam] = useState(0);
  const [to, setTo] = useState<number[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (campuses.length < 2) return null;
  return (
    <Card>
      <CardHeader title="Common exam across campuses" />
      <CardBody className="space-y-2 text-[13px]">
        <div className="flex flex-wrap items-end gap-2">
          <label>From<Select className="mt-1 h-8" aria-label="Exam from campus" value={from} onChange={(e) => { setFrom(Number(e.target.value)); setExams(null); setExam(0); }}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
          {exams ? <label>Exam<Select className="mt-1 h-8 w-64" aria-label="Exam to copy" value={exam} onChange={(e) => setExam(Number(e.target.value))}>{exams.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.papers} papers)</option>)}</Select></label>
            : <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const x = await campusExams(from); setExams(x); setExam(x[0]?.id ?? 0); })}>Choose the exam</Button>}
        </div>
        <div className="flex flex-wrap gap-1"><span className="mr-1 text-ink-700">To</span>{campuses.filter((c) => c.id !== from).map((c) => (
          <label key={c.id} className="flex items-center gap-1 rounded-sm border border-hair px-1.5 py-0.5 text-[12px]"><input type="checkbox" checked={to.includes(c.id)} onChange={(e) => setTo(e.target.checked ? [...to, c.id] : to.filter((x) => x !== c.id))} />{c.name}</label>))}</div>
        <Button size="sm" disabled={pending || !exam || !to.length} onClick={() => start(async () => { const r = await copyExam(exam, to); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); })}>Copy the timetable</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
