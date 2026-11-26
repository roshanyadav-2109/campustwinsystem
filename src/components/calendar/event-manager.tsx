"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { addNationalHolidays, deleteEvent, saveEvent, type EventKind } from "@/app/dashboard/calendar/actions";

export type ManagedEvent = {
  id: number; title: string; kind: EventKind; from: string; to: string;
  classId: number | null; sectionId: number | null; description: string | null;
};
export type ClassOpt = { id: number; name: string; sections: { id: number; name: string }[] };

const KIND_LABEL: Record<EventKind, string> = {
  holiday: "Holiday", exam: "Exam", ptm: "Parent-teacher meeting", activity: "Activity or event", other: "Other",
};
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const blank = { title: "", kind: "holiday" as EventKind, from: "", to: "", target: "school", description: "" };

// The principal and office keep the school calendar here. "Applies to" lets a
// day off or an exam cover the whole school, one class, or one section.
export function EventManager({ events, classes }: { events: ManagedEvent[]; classes: ClassOpt[] }) {
  const id = useId();
  const [editing, setEditing] = useState<number | null>(null);
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.to >= today);
  const past = events.filter((e) => e.to < today);

  const targetLabel = (e: ManagedEvent) => {
    if (e.sectionId) {
      for (const c of classes) { const s = c.sections.find((x) => x.id === e.sectionId); if (s) return `${c.name} ${s.name}`; }
      return "One section";
    }
    if (e.classId) return `Class ${classes.find((c) => c.id === e.classId)?.name ?? ""}`.trim();
    return "Whole school";
  };

  function edit(e: ManagedEvent) {
    setEditing(e.id); setMsg(null);
    setF({ title: e.title, kind: e.kind, from: e.from, to: e.to, description: e.description ?? "",
      target: e.sectionId ? `s:${e.sectionId}` : e.classId ? `c:${e.classId}` : "school" });
  }
  function reset() { setEditing(null); setF(blank); }

  function save() {
    setMsg(null);
    const [t, v] = f.target.split(":");
    start(async () => {
      const res = await saveEvent({ id: editing, title: f.title, kind: f.kind, from: f.from, to: f.to || f.from,
        classId: t === "c" ? Number(v) : null, sectionId: t === "s" ? Number(v) : null, description: f.description });
      if (!res.ok) { setMsg({ text: res.error, ok: false }); return; }
      setMsg({ text: editing ? "Saved." : "Added to the calendar.", ok: true });
      reset();
    });
  }
  function remove(e: ManagedEvent) {
    if (!window.confirm(`Remove "${e.title}" from the calendar?`)) return;
    start(async () => {
      const res = await deleteEvent(e.id);
      setMsg(res.ok ? { text: "Removed.", ok: true } : { text: res.error, ok: false });
      if (editing === e.id) reset();
    });
  }
  function national() {
    setMsg(null);
    start(async () => {
      const res = await addNationalHolidays();
      if (!res.ok) { setMsg({ text: res.error, ok: false }); return; }
      setMsg({ text: res.added ? `Added ${res.added} national holiday${res.added === 1 ? "" : "s"}.` : "The national holidays are already on the calendar.", ok: true });
    });
  }

  const row = (e: ManagedEvent) => (
    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink-900">{e.title}</div>
        <div className="text-[12px] text-ink-500">
          {KIND_LABEL[e.kind]} · {e.from === e.to ? fmt(e.from) : `${fmt(e.from)} to ${fmt(e.to)}`} · {targetLabel(e)}
        </div>
      </div>
      <Button size="sm" variant="subtle" onClick={() => edit(e)} disabled={pending}>Edit</Button>
      <Button size="sm" variant="subtle" onClick={() => remove(e)} disabled={pending}>Remove</Button>
    </li>
  );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader title="School calendar" action={<Button size="sm" variant="subtle" onClick={national} disabled={pending}>Add national holidays</Button>} />
        <CardBody className="pt-1">
          {upcoming.length === 0 && past.length === 0 ? (
            <p className="py-3 text-[13px] text-ink-500">Nothing on the calendar yet. Add your holidays, exam dates and meetings.</p>
          ) : (
            <>
              {upcoming.length > 0 && <ul className="divide-y divide-hair">{upcoming.map(row)}</ul>}
              {past.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[13px] font-medium text-ink-700">Earlier this year ({past.length})</summary>
                  <ul className="divide-y divide-hair">{past.map(row)}</ul>
                </details>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={editing ? "Change this day" : "Add to the calendar"} />
        <CardBody className="space-y-3 pt-1">
          <Field label="Name" htmlFor={`${id}-t`}>
            <Input id={`${id}-t`} value={f.title} maxLength={160} placeholder="Diwali holidays" onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="What kind of day" htmlFor={`${id}-k`}>
            <Select id={`${id}-k`} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as EventKind })}>
              {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor={`${id}-f`}><Input id={`${id}-f`} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to && f.to < e.target.value ? e.target.value : f.to })} /></Field>
            <Field label="To (if more than a day)" htmlFor={`${id}-to`}><Input id={`${id}-to`} type="date" min={f.from || undefined} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          </div>
          <Field label="Applies to" htmlFor={`${id}-a`}>
            <Select id={`${id}-a`} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>
              <option value="school">Whole school</option>
              {classes.map((c) => (
                <optgroup key={c.id} label={`Class ${c.name}`}>
                  <option value={`c:${c.id}`}>All of class {c.name}</option>
                  {c.sections.map((s) => <option key={s.id} value={`s:${s.id}`}>{c.name} {s.name} only</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Details (optional)" htmlFor={`${id}-d`}>
            <Textarea id={`${id}-d`} rows={2} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          {f.kind === "holiday" && <p className="text-[12px] text-ink-500">On a holiday the attendance register opens as a holiday, and staff leave does not count the day.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={pending || !f.title.trim() || !f.from}>{pending ? "Saving…" : editing ? "Save changes" : "Add"}</Button>
            {editing && <Button variant="subtle" onClick={reset} disabled={pending}>Cancel</Button>}
          </div>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
