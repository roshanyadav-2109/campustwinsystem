"use client";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { createEnquiry } from "@/app/dashboard/admissions/actions";
import {
  EMAIL_RE, LIMITS, SOURCES, SOURCE_LABEL, cleanPhone, type ClassRef, type StaffRef,
} from "@/components/admissions/shared";

type Values = {
  childName: string; dateOfBirth: string; classId: string; guardianName: string; phone: string; email: string;
  address: string; previousSchool: string; message: string; source: string; assignedTo: string; nextFollowUp: string;
};

const BLANK: Values = {
  childName: "", dateOfBirth: "", classId: "", guardianName: "", phone: "", email: "",
  address: "", previousSchool: "", message: "", source: "walk_in", assignedTo: "", nextFollowUp: "",
};

// The office's form for a new enquiry (walk-in, phone call, referral).
export function EnquiryForm({
  classes, staff, onDone, onCancel,
}: {
  classes: ClassRef[];
  staff: StaffRef[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [v, setV] = useState<Values>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Values, val: string) => setV((p) => ({ ...p, [k]: val }));
  const today = new Date().toISOString().slice(0, 10);

  function check(): string | null {
    if (!v.childName.trim()) return "Enter the child's name.";
    if (!v.classId) return "Choose the class sought.";
    if (!v.guardianName.trim()) return "Enter the parent or guardian's name.";
    if (!cleanPhone(v.phone)) return "Enter a phone number with 8 to 15 digits.";
    if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) return "Enter a valid email address, or leave it empty.";
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = check();
    if (problem) { setError(problem); return; }
    setError(null);
    start(async () => {
      const res = await createEnquiry({
        ...v,
        classId: Number(v.classId) || null,
        assignedTo: Number(v.assignedTo) || null,
      });
      if (!res.ok) { setError(res.error); return; }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <h3 className="t-h3 text-ink-900">Child</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Child's name" htmlFor={`${id}-child`}>
            <Input id={`${id}-child`} value={v.childName} autoFocus maxLength={LIMITS.name}
              onChange={(e) => set("childName", e.target.value)} />
          </Field>
        </div>
        <Field label="Date of birth" htmlFor={`${id}-dob`}>
          <Input id={`${id}-dob`} type="date" value={v.dateOfBirth} max={today} onChange={(e) => set("dateOfBirth", e.target.value)} />
        </Field>
        <Field label="Class sought" htmlFor={`${id}-class`}>
          <Select id={`${id}-class`} value={v.classId} onChange={(e) => set("classId", e.target.value)}>
            <option value="">Choose…</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Previous school" htmlFor={`${id}-prev`}>
            <Input id={`${id}-prev`} value={v.previousSchool} maxLength={LIMITS.school}
              onChange={(e) => set("previousSchool", e.target.value)} />
          </Field>
        </div>
      </div>

      <h3 className="t-h3 mt-6 text-ink-900">Parent or guardian</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-parent`}>
          <Input id={`${id}-parent`} value={v.guardianName} maxLength={LIMITS.name}
            onChange={(e) => set("guardianName", e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor={`${id}-phone`}>
          <Input id={`${id}-phone`} type="tel" inputMode="tel" value={v.phone} maxLength={20}
            onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email" htmlFor={`${id}-email`}>
          <Input id={`${id}-email`} type="email" value={v.email} maxLength={LIMITS.email}
            onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Address" htmlFor={`${id}-address`}>
          <Input id={`${id}-address`} value={v.address} maxLength={LIMITS.address}
            onChange={(e) => set("address", e.target.value)} />
        </Field>
      </div>

      <h3 className="t-h3 mt-6 text-ink-900">Enquiry</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Source" htmlFor={`${id}-source`}>
          <Select id={`${id}-source`} value={v.source} onChange={(e) => set("source", e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Assigned to" htmlFor={`${id}-assign`}>
          <Select id={`${id}-assign`} value={v.assignedTo} onChange={(e) => set("assignedTo", e.target.value)}>
            <option value="">No one yet</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Next follow-up" htmlFor={`${id}-next`}>
          <Input id={`${id}-next`} type="date" value={v.nextFollowUp} onChange={(e) => set("nextFollowUp", e.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <Field label="Note" htmlFor={`${id}-msg`}>
            <Textarea id={`${id}-msg`} rows={2} value={v.message} maxLength={LIMITS.message}
              onChange={(e) => set("message", e.target.value)} />
          </Field>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-[13px] font-medium text-down">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add enquiry"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}
