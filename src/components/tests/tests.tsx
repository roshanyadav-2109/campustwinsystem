"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/hover-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { saveTest, publishTest, startTest, saveAnswer, submitTest, markShort, reviewAttempt, type QuestionIn, type TestIn } from "@/app/dashboard/tests/actions";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p> : null);
const when = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const KIND: Record<string, string> = { single: "One correct choice", multi: "Several correct choices", truefalse: "True or false", number: "A number", short: "Short written answer" };
// datetime-local (India time) <-> ISO
const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);
const fromLocal = (v: string) => new Date(`${v}:00+05:30`).toISOString();

export type Pair = { section_id: number; subject_id: number; label: string; subject: string };
type QDraft = { kind: QuestionIn["kind"]; prompt: string; options: string; correct: number[]; tf: boolean; num: string; tol: string; marks: string; negative: string };
const blankQ = (): QDraft => ({ kind: "single", prompt: "", options: "", correct: [], tf: true, num: "", tol: "0", marks: "1", negative: "0" });

// The teacher's builder: subject and sections, timing, and the questions.
export function TestBuilder({ pairs, initial }: { pairs: Pair[]; initial?: (TestIn & { id: number; locked: boolean; published: boolean }) | null }) {
  const subjects = [...new Map(pairs.map((p) => [p.subject_id, p.subject])).entries()];
  const now = new Date();
  const [f, setF] = useState({
    subject_id: initial?.subject_id ?? subjects[0]?.[0] ?? 0, section_ids: initial?.section_ids ?? [] as number[], title: initial?.title ?? "", instructions: initial?.instructions ?? "",
    opens: initial ? toLocal(initial.opens_at) : toLocal(now.toISOString()), closes: initial ? toLocal(initial.closes_at) : toLocal(new Date(now.getTime() + 7 * 86400000).toISOString()),
    minutes: String(initial?.minutes ?? 30), attempts: String(initial?.attempts ?? 1), shuffle: initial?.shuffle ?? false, show_answers: initial?.show_answers ?? "after_close",
  });
  const [qs, setQs] = useState<QDraft[]>(initial?.questions?.length ? initial.questions.map((q) => ({
    kind: q.kind, prompt: q.prompt, options: (q.options ?? []).join("\n"), correct: q.kind === "single" ? [Number(q.answer)] : q.kind === "multi" ? (q.answer as number[]) : [],
    tf: q.kind === "truefalse" ? Boolean(q.answer) : true, num: q.kind === "number" ? String((q.answer as { value: number }).value) : "", tol: q.kind === "number" ? String((q.answer as { tolerance?: number }).tolerance ?? 0) : "0",
    marks: String(q.marks), negative: String(q.negative ?? 0) })) : [blankQ()]);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const sections = pairs.filter((p) => p.subject_id === f.subject_id);
  const locked = initial?.locked ?? false;
  const setQ = (i: number, patch: Partial<QDraft>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const build = (): QuestionIn[] => qs.map((q) => ({
    kind: q.kind, prompt: q.prompt, options: q.kind === "single" || q.kind === "multi" ? q.options.split("\n").map((x) => x.trim()).filter(Boolean) : [],
    answer: q.kind === "single" ? q.correct[0] ?? null : q.kind === "multi" ? q.correct : q.kind === "truefalse" ? q.tf : q.kind === "number" ? { value: Number(q.num), tolerance: Number(q.tol) || 0 } : null,
    marks: Number(q.marks) || 1, negative: Number(q.negative) || 0 }));
  return (
    <div className="space-y-4 text-[13px]">
      <Note m={msg} />
      <Card>
        <CardHeader title={initial ? "Edit the test" : "New test"} />
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Title<Input className="mt-1" aria-label="Test title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label>Subject<Select className="mt-1" aria-label="Test subject" value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: Number(e.target.value), section_ids: [] })}>{subjects.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select></label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1"><span className="text-ink-700">Sections:</span>{sections.map((s) => (
            <label key={s.section_id} className="flex items-center gap-1"><input type="checkbox" checked={f.section_ids.includes(s.section_id)} onChange={(e) => setF({ ...f, section_ids: e.target.checked ? [...f.section_ids, s.section_id] : f.section_ids.filter((x) => x !== s.section_id) })} />{s.label}</label>))}</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label>Opens<Input type="datetime-local" className="mt-1" aria-label="Opens at" value={f.opens} onChange={(e) => setF({ ...f, opens: e.target.value })} /></label>
            <label>Closes<Input type="datetime-local" className="mt-1" aria-label="Closes at" value={f.closes} onChange={(e) => setF({ ...f, closes: e.target.value })} /></label>
            <label>Time limit (minutes)<Input className="mt-1" inputMode="numeric" aria-label="Time limit in minutes" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></label>
            <label>Attempts<Input className="mt-1" inputMode="numeric" aria-label="Attempts allowed" value={f.attempts} onChange={(e) => setF({ ...f, attempts: e.target.value })} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1"><input type="checkbox" checked={f.shuffle} onChange={(e) => setF({ ...f, shuffle: e.target.checked })} />Shuffle the questions for each student</label>
            <label className="flex items-center gap-2">Correct answers shown<Select className="h-8" aria-label="When answers are shown" value={f.show_answers} onChange={(e) => setF({ ...f, show_answers: e.target.value })}>
              <option value="after_close">after the test closes</option><option value="after_submit">right after submitting</option><option value="never">never</option></Select></label>
          </div>
          <label className="block">Instructions (optional)<Textarea className="mt-1" rows={2} aria-label="Instructions" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
        </CardBody>
      </Card>
      {locked && <p className="text-ink-700">Students have started this test, so its questions can no longer change. You can still change the timing and sections.</p>}
      {qs.map((q, i) => (
        <Card key={i}>
          <CardHeader title={`Question ${i + 1}`} action={!locked && qs.length > 1 ? <button type="button" className="text-[12px] text-ink-500 hover:text-down" onClick={() => setQs(qs.filter((_, j) => j !== i))}>remove</button> : undefined} />
          <CardBody className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <Select className="h-8 w-56" aria-label={`Question ${i + 1} kind`} disabled={locked} value={q.kind} onChange={(e) => setQ(i, { kind: e.target.value as QDraft["kind"], correct: [] })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              <label className="flex items-center gap-1">Marks<Input className="h-8 w-16" aria-label={`Question ${i + 1} marks`} disabled={locked} value={q.marks} onChange={(e) => setQ(i, { marks: e.target.value })} /></label>
              {q.kind !== "short" && <label className="flex items-center gap-1">Minus for a wrong answer<Input className="h-8 w-16" aria-label={`Question ${i + 1} negative marks`} disabled={locked} value={q.negative} onChange={(e) => setQ(i, { negative: e.target.value })} /></label>}
            </div>
            <Textarea rows={2} aria-label={`Question ${i + 1} text`} disabled={locked} placeholder="The question" value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />
            {(q.kind === "single" || q.kind === "multi") && <>
              <Textarea rows={3} aria-label={`Question ${i + 1} choices`} disabled={locked} placeholder="Choices, one per line" value={q.options} onChange={(e) => setQ(i, { options: e.target.value, correct: [] })} />
              <div className="flex flex-wrap gap-3"><span className="text-ink-700">Correct:</span>{q.options.split("\n").map((x) => x.trim()).filter(Boolean).map((o, k) => (
                <label key={k} className="flex items-center gap-1"><input type={q.kind === "single" ? "radio" : "checkbox"} disabled={locked} name={`q${i}`} checked={q.correct.includes(k)}
                  onChange={(e) => setQ(i, { correct: q.kind === "single" ? [k] : e.target.checked ? [...q.correct, k] : q.correct.filter((x) => x !== k) })} />{o}</label>))}</div></>}
            {q.kind === "truefalse" && <label className="flex items-center gap-2">Correct:<Select className="h-8 w-28" aria-label={`Question ${i + 1} correct answer`} disabled={locked} value={q.tf ? "true" : "false"} onChange={(e) => setQ(i, { tf: e.target.value === "true" })}><option value="true">True</option><option value="false">False</option></Select></label>}
            {q.kind === "number" && <div className="flex flex-wrap gap-3"><label className="flex items-center gap-1">Answer<Input className="h-8 w-28" aria-label={`Question ${i + 1} answer`} disabled={locked} value={q.num} onChange={(e) => setQ(i, { num: e.target.value })} /></label>
              <label className="flex items-center gap-1">give or take<Input className="h-8 w-20" aria-label={`Question ${i + 1} tolerance`} disabled={locked} value={q.tol} onChange={(e) => setQ(i, { tol: e.target.value })} /></label></div>}
            {q.kind === "short" && <p className="text-ink-500">You mark this answer after the test.</p>}
          </CardBody>
        </Card>))}
      <div className="flex flex-wrap gap-2">
        {!locked && <Button size="sm" variant="ghost" onClick={() => setQs([...qs, blankQ()])}>Add a question</Button>}
        <Button disabled={pending} onClick={() => start(async () => {
          const r = await saveTest(initial?.id ?? null, { subject_id: f.subject_id, section_ids: f.section_ids, title: f.title, instructions: f.instructions, opens_at: fromLocal(f.opens), closes_at: fromLocal(f.closes),
            minutes: Number(f.minutes), attempts: Number(f.attempts) || 1, shuffle: f.shuffle, show_answers: f.show_answers, questions: build() });
          setMsg(r.ok ? { ok: true, text: `${r.message} Publish it when ready.` } : { ok: false, text: r.error });
          if (r.ok) router.push(`/dashboard/tests?edit=${r.data}`);
        })}>Save the test</Button>
        {initial && <Button variant="subtle" disabled={pending} onClick={() => start(async () => { const r = await publishTest(initial.id, !initial.published); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>{initial.published ? "Hide from students" : "Publish to students"}</Button>}
      </div>
    </div>
  );
}

// The student takes the test: the server keeps the time; each answer is saved as it is chosen.
export function TakeTest({ testId }: { testId: number }) {
  const [t, setT] = useState<Awaited<ReturnType<typeof startTest>> | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [left, setLeft] = useState(0);
  const [msg, setMsg] = useState<Msg>(null);
  const [done, setDone] = useState<{ score: number; to_mark: number } | null>(null);
  const [pending, start] = useTransition();
  const submitted = useRef(false);
  useEffect(() => { void startTest(testId).then((r) => { setT(r); if (r.ok) setAnswers(r.data.answers ?? {}); }); }, [testId]);
  const attempt = t && t.ok ? t.data.attempt : 0;
  const submit = () => { if (submitted.current || !attempt) return; submitted.current = true; start(async () => { const r = await submitTest(attempt); if (r.ok) setDone(r.data); else { submitted.current = false; setMsg({ ok: false, text: r.error }); } }); };
  useEffect(() => {
    if (!t || !t.ok) return;
    const end = new Date(t.data.deadline).getTime();
    const tick = () => { const s = Math.max(0, Math.round((end - Date.now()) / 1000)); setLeft(s); if (s === 0) submit(); };
    tick(); const h = setInterval(tick, 1000); return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  const put = (qid: number, v: unknown) => { setAnswers((a) => ({ ...a, [qid]: v })); void saveAnswer(attempt, qid, v).then((r) => { if (!r.ok) setMsg({ ok: false, text: r.error }); }); };
  if (!t) return <p className="text-[13px] text-ink-500">Opening the test…</p>;
  if (!t.ok) return <p role="alert" className="text-[13px] text-down">{t.error} <Link href="/dashboard/tests" className="text-[#0F6CBD] underline">Back</Link></p>;
  if (done) return (
    <Card><CardBody className="space-y-2 text-[14px]"><p className="font-semibold text-ink-900">Submitted.</p>
      <p>Score so far: {Number(done.score)}{done.to_mark ? ` (${done.to_mark} written answer${done.to_mark === 1 ? "" : "s"} still to be marked by the teacher)` : ""}.</p>
      <Link href="/dashboard/tests" className="text-[#0F6CBD] underline">Back to tests</Link></CardBody></Card>);
  const q = t.data;
  return (
    <div className="space-y-3 text-[14px]">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-sm border border-hair bg-white px-3 py-2">
        <b>{q.title}</b><span className={`tabular ${left < 60 ? "text-down" : "text-ink-900"}`}>Time left {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
      </div>
      {q.instructions && <p className="text-[13px] text-ink-700">{q.instructions}</p>}
      <Note m={msg} />
      {q.questions.map((x, i) => (
        <Card key={x.id}><CardBody className="space-y-2">
          <p className="font-medium text-ink-900">{i + 1}. {x.prompt} <span className="text-[12px] font-normal text-ink-500">({Number(x.marks)} mark{Number(x.marks) === 1 ? "" : "s"}{Number(x.negative) ? `, minus ${Number(x.negative)} if wrong` : ""})</span></p>
          {x.kind === "single" && x.options.map((o, k) => <label key={k} className="flex items-center gap-2"><input type="radio" name={`q${x.id}`} checked={answers[x.id] === k} onChange={() => put(x.id, k)} />{o}</label>)}
          {x.kind === "multi" && x.options.map((o, k) => { const cur = (answers[x.id] as number[] | undefined) ?? []; return <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={cur.includes(k)} onChange={(e) => put(x.id, e.target.checked ? [...cur, k] : cur.filter((y) => y !== k))} />{o}</label>; })}
          {x.kind === "truefalse" && ["True", "False"].map((o) => <label key={o} className="flex items-center gap-2"><input type="radio" name={`q${x.id}`} checked={answers[x.id] === (o === "True")} onChange={() => put(x.id, o === "True")} />{o}</label>)}
          {x.kind === "number" && <Input className="w-40" inputMode="decimal" aria-label={`Answer to question ${i + 1}`} defaultValue={answers[x.id] != null ? String(answers[x.id]) : ""} onBlur={(e) => put(x.id, e.target.value.trim() === "" ? null : Number(e.target.value))} />}
          {x.kind === "short" && <Textarea rows={4} aria-label={`Answer to question ${i + 1}`} defaultValue={(answers[x.id] as string) ?? ""} onBlur={(e) => put(x.id, e.target.value)} />}
        </CardBody></Card>))}
      <Button disabled={pending} onClick={() => { if (confirm("Submit the test? You can't change answers afterwards.")) submit(); }}>Submit the test</Button>
    </div>
  );
}

// Results for the teacher, with marking of written answers; also the student's own review.
export function Review({ attemptId, canMark }: { attemptId: number; canMark: boolean }) {
  const [r, setR] = useState<Awaited<ReturnType<typeof reviewAttempt>>>(null);
  const [marks, setMarks] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const load = () => void reviewAttempt(attemptId).then(setR);
  useEffect(load, [attemptId]);
  if (!r) return <p className="text-[13px] text-ink-500">Loading…</p>;
  const show = (q: { kind: string; options: string[] }, v: unknown) => v == null ? "No answer" : q.kind === "single" ? q.options[Number(v)] : q.kind === "multi" ? (v as number[]).map((k) => q.options[k]).join(", ") : q.kind === "truefalse" ? (v ? "True" : "False") : q.kind === "number" ? String((v as { value?: number }).value ?? v) : String(v);
  return (
    <div className="space-y-2 text-[13px]">
      <p className="text-[14px]">Score: <b>{r.score != null ? Number(r.score) : "-"}</b>{r.to_mark ? ` · ${r.to_mark} written answer${r.to_mark === 1 ? "" : "s"} to mark` : ""}</p>
      <Note m={msg} />
      {!r.answers_shown && <p className="text-ink-500">The answers are shown when the test closes.</p>}
      {r.questions?.map((q, i) => (
        <div key={q.id} className="rounded-sm border border-hair bg-white p-3">
          <p className="font-medium">{i + 1}. {q.prompt}</p>
          <p>Answer given: {show(q, q.given)}</p>
          {q.kind !== "short" && <p className="text-ink-700">Correct: {show(q, q.answer)}</p>}
          <p className={q.got == null ? "text-ink-500" : Number(q.got) > 0 ? "text-up" : "text-down"}>{q.got == null ? "Not marked yet" : `${Number(q.got)} of ${Number(q.marks)}`}</p>
          {canMark && q.kind === "short" && <div className="mt-1 flex items-center gap-2"><Input className="h-8 w-20" aria-label={`Marks for question ${i + 1}`} value={marks[q.id] ?? (q.got != null ? String(q.got) : "")} onChange={(e) => setMarks({ ...marks, [q.id]: e.target.value })} />
            <span className="text-ink-500">of {Number(q.marks)}</span>
            <Button size="sm" disabled={pending} onClick={() => start(async () => { const x = await markShort(attemptId, q.id, Number(marks[q.id])); setMsg(x.ok ? { ok: true, text: x.message ?? "" } : { ok: false, text: x.error }); if (x.ok) load(); })}>Save marks</Button></div>}
        </div>))}
    </div>
  );
}
export { when };
