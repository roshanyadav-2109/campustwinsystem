"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Select } from "@/components/ui/field";
import { Dialog } from "@/components/students/student-form";
import { useNavigate } from "@/components/nav-progress";
import { createHomework, updateHomework, deleteHomework } from "@/app/dashboard/homework/actions";

export type FormSection = { id: number; label: string; subjects: { id: number; name: string }[] };

const TITLE_MAX = 120;
const INSTRUCTIONS_MAX = 2000;
const LINK_MAX = 500;

const linkProblem = (v: string) => {
  const s = v.trim();
  return !!s && (!s.startsWith("https://") || s.length > LINK_MAX || /\s/.test(s));
};

// The fields a piece of homework has, shared by "Set homework" and "Edit".
function HomeworkFields({
  title, setTitle, instructions, setInstructions, due, setDue, link, setLink, maxMarks, setMaxMarks, minDue, idPrefix,
}: {
  title: string; setTitle: (v: string) => void;
  instructions: string; setInstructions: (v: string) => void;
  due: string; setDue: (v: string) => void;
  link: string; setLink: (v: string) => void;
  maxMarks: string; setMaxMarks: (v: string) => void;
  minDue?: string;
  idPrefix: string;
}) {
  return (
    <>
      <Field label="Title" htmlFor={`${idPrefix}-title`}>
        <Input id={`${idPrefix}-title`} value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Instructions" htmlFor={`${idPrefix}-instructions`} hint={`${instructions.length} of ${INSTRUCTIONS_MAX} characters`}>
        <Textarea id={`${idPrefix}-instructions`} rows={4} value={instructions} maxLength={INSTRUCTIONS_MAX} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Due date" htmlFor={`${idPrefix}-due`}>
          <Input id={`${idPrefix}-due`} type="date" value={due} min={minDue} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Maximum marks" htmlFor={`${idPrefix}-max`} hint="Optional">
          <Input id={`${idPrefix}-max`} type="number" inputMode="decimal" min={1} max={1000} step="any" value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
        </Field>
      </div>
      <Field label="Worksheet link" htmlFor={`${idPrefix}-link`} hint="Optional. Must start with https://">
        <Input id={`${idPrefix}-link`} type="url" inputMode="url" placeholder="https://" value={link} maxLength={LINK_MAX} onChange={(e) => setLink(e.target.value)} />
      </Field>
    </>
  );
}

export function HomeworkForm({
  sections, defaultSectionId, defaultSubjectId, today,
}: {
  sections: FormSection[];
  defaultSectionId?: number | null;
  defaultSubjectId?: number | null;
  today: string;
}) {
  const firstSection = sections.find((s) => s.id === defaultSectionId) ?? sections[0];
  const [sectionId, setSectionId] = useState<number>(firstSection?.id ?? 0);
  const [subjectId, setSubjectId] = useState<number>(
    firstSection?.subjects.find((s) => s.id === defaultSubjectId)?.id ?? firstSection?.subjects[0]?.id ?? 0,
  );
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [due, setDue] = useState("");
  const [link, setLink] = useState("");
  const [maxMarks, setMaxMarks] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const section = sections.find((s) => s.id === sectionId);
  const subjects = section?.subjects ?? [];

  function changeSection(id: number) {
    setSectionId(id);
    const next = sections.find((s) => s.id === id)?.subjects ?? [];
    if (!next.some((s) => s.id === subjectId)) setSubjectId(next[0]?.id ?? 0);
  }

  function submit() {
    setErr(null); setDone(false);
    if (linkProblem(link)) { setErr("The link must start with https://"); return; }
    start(async () => {
      const res = await createHomework({
        sectionId, subjectId, title, instructions, dueDate: due,
        linkUrl: link.trim() || null, maxMarks: maxMarks.trim() || null,
      });
      if (res.ok) {
        setTitle(""); setInstructions(""); setDue(""); setLink(""); setMaxMarks("");
        setDone(true); setTimeout(() => setDone(false), 2500);
      } else setErr(res.error);
    });
  }

  return (
    <Card className="self-start">
      <CardHeader title="Set homework" />
      <CardBody className="space-y-3 pt-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Section" htmlFor="hw-new-section">
            <Select id="hw-new-section" value={sectionId} onChange={(e) => changeSection(Number(e.target.value))}>
              {sections.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
            </Select>
          </Field>
          <Field label="Subject" htmlFor="hw-new-subject">
            <Select id="hw-new-subject" value={subjectId} onChange={(e) => setSubjectId(Number(e.target.value))}>
              {subjects.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </Select>
          </Field>
        </div>
        <HomeworkFields idPrefix="hw-new" minDue={today}
          title={title} setTitle={setTitle} instructions={instructions} setInstructions={setInstructions}
          due={due} setDue={setDue} link={link} setLink={setLink} maxMarks={maxMarks} setMaxMarks={setMaxMarks} />
        {err && <p className="text-[13px] font-medium text-down" role="alert">{err}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={pending || !sectionId || !subjectId || !title.trim() || !due}>
            {pending ? "Saving" : "Set homework"}
          </Button>
          {done && <span className="text-[13px] font-medium text-up">Homework set</span>}
        </div>
      </CardBody>
    </Card>
  );
}

export type EditableHomework = {
  id: number;
  title: string;
  instructions: string;
  due_date: string;
  link_url: string | null;
  max_marks: number | null;
};

// Edit and delete, shown only on homework the signed-in teacher set.
export function HomeworkOwnerActions({ hw, afterDeleteHref }: { hw: EditableHomework; afterDeleteHref?: string }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function remove() {
    setErr(null);
    start(async () => {
      const res = await deleteHomework(hw.id);
      if (!res.ok) { setErr(res.error); return; }
      setConfirming(false);
      if (afterDeleteHref) navigate(afterDeleteHref);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-[13px] text-ink-700">Delete this homework and its submissions?</span>
          <Button size="sm" variant="danger" disabled={pending} onClick={remove}>{pending ? "Deleting" : "Delete"}</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setConfirming(false); setErr(null); }}>Cancel</Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="subtle" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>Delete</Button>
        </>
      )}
      {err && <span className="text-[13px] font-medium text-down" role="alert">{err}</span>}
      {editing && <EditDialog hw={hw} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditDialog({ hw, onClose }: { hw: EditableHomework; onClose: () => void }) {
  const [title, setTitle] = useState(hw.title);
  const [instructions, setInstructions] = useState(hw.instructions);
  const [due, setDue] = useState(hw.due_date);
  const [link, setLink] = useState(hw.link_url ?? "");
  const [maxMarks, setMaxMarks] = useState(hw.max_marks != null ? String(hw.max_marks) : "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    if (linkProblem(link)) { setErr("The link must start with https://"); return; }
    start(async () => {
      const res = await updateHomework(hw.id, {
        title, instructions, dueDate: due, linkUrl: link.trim() || null, maxMarks: maxMarks.trim() || null,
      });
      if (res.ok) onClose();
      else setErr(res.error);
    });
  }

  return (
    <Dialog title="Edit homework" onClose={onClose}>
      <div className="space-y-3">
        <HomeworkFields idPrefix={`hw-edit-${hw.id}`}
          title={title} setTitle={setTitle} instructions={instructions} setInstructions={setInstructions}
          due={due} setDue={setDue} link={link} setLink={setLink} maxMarks={maxMarks} setMaxMarks={setMaxMarks} />
        {err && <p className="text-[13px] font-medium text-down" role="alert">{err}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || !title.trim() || !due}>{pending ? "Saving" : "Save changes"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
