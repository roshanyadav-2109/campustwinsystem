"use client";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { submitApplication } from "@/app/apply/actions";
import { EMAIL_RE, LIMITS, cleanPhone, type ClassRef } from "@/components/admissions/shared";

type Values = {
  childName: string; dateOfBirth: string; classId: string; guardianName: string;
  phone: string; email: string; previousSchool: string; message: string; website: string;
};

const BLANK: Values = {
  childName: "", dateOfBirth: "", classId: "", guardianName: "",
  phone: "", email: "", previousSchool: "", message: "", website: "",
};

// The public admission form. Needs no sign-in.
export function ApplyForm({ classes }: { classes: ClassRef[] }) {
  const [token, setToken] = useState<string | null>(null);
  const id = useId();
  const [v, setV] = useState<Values>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Values, val: string) => setV((p) => ({ ...p, [k]: val }));

  const today = new Date().toISOString().slice(0, 10);

  function check(): string | null {
    if (!v.childName.trim()) return "Please enter your child's name.";
    if (!v.dateOfBirth) return "Please enter your child's date of birth.";
    if (!v.classId) return "Please choose the class you are applying for.";
    if (!v.guardianName.trim()) return "Please enter the parent's name.";
    if (!cleanPhone(v.phone)) return "Please enter a phone number with 8 to 15 digits.";
    if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) return "Please enter a valid email address, or leave it empty.";
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const problem = check();
    if (problem) { setError(problem); return; }
    setError(null);
    start(async () => {
      try {
        const res = await submitApplication({ ...v, classId: Number(v.classId) || null });
        if (!res.ok) { setError(res.error); return; }
        setV(BLANK);
        setSentFor(res.firstName);
        setToken(res.token ?? null);
      } catch {
        setError("We could not send your application just now. Please check your connection and try again.");
      }
    });
  }

  if (sentFor !== null) {
    return (
      <div role="status" className="rounded-md border border-hair bg-surface px-5 py-6">
        <h2 className="t-h2 text-ink-900">Application received</h2>
        <p className="mt-2 text-[14px] text-ink-700">
          Thank you. We have received the application for {sentFor}. The school office will contact you about the next steps.
        </p>
        {token && <p className="mt-3 text-[14px]"><a href={`/apply/status/${token}`} className="font-medium text-[#0F6CBD] hover:underline">Follow your application, pay the application fee and answer an offer here</a>. Keep this link; it is private to you.</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-md border border-hair bg-surface px-5 py-5">
      <h2 className="t-h3 text-ink-900">Child</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Child's name" htmlFor={`${id}-child`}>
            <Input id={`${id}-child`} value={v.childName} maxLength={LIMITS.name} autoComplete="off" required
              onChange={(e) => set("childName", e.target.value)} />
          </Field>
        </div>
        <Field label="Date of birth" htmlFor={`${id}-dob`}>
          <Input id={`${id}-dob`} type="date" value={v.dateOfBirth} max={today} required
            onChange={(e) => set("dateOfBirth", e.target.value)} />
        </Field>
        <Field label="Class sought" htmlFor={`${id}-class`}>
          <Select id={`${id}-class`} value={v.classId} required onChange={(e) => set("classId", e.target.value)}>
            <option value="">Choose…</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Previous school (optional)" htmlFor={`${id}-prev`}>
            <Input id={`${id}-prev`} value={v.previousSchool} maxLength={LIMITS.school}
              onChange={(e) => set("previousSchool", e.target.value)} />
          </Field>
        </div>
      </div>

      <h2 className="t-h3 mt-6 text-ink-900">Parent or guardian</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Parent's name" htmlFor={`${id}-parent`}>
            <Input id={`${id}-parent`} value={v.guardianName} maxLength={LIMITS.name} autoComplete="name" required
              onChange={(e) => set("guardianName", e.target.value)} />
          </Field>
        </div>
        <Field label="Phone" htmlFor={`${id}-phone`}>
          <Input id={`${id}-phone`} type="tel" inputMode="tel" value={v.phone} maxLength={20} autoComplete="tel" required
            onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email (optional)" htmlFor={`${id}-email`}>
          <Input id={`${id}-email`} type="email" value={v.email} maxLength={LIMITS.email} autoComplete="email"
            onChange={(e) => set("email", e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Message (optional)" htmlFor={`${id}-msg`} hint={`${v.message.length} of ${LIMITS.message} characters`}>
            <Textarea id={`${id}-msg`} rows={3} value={v.message} maxLength={LIMITS.message}
              onChange={(e) => set("message", e.target.value)} />
          </Field>
        </div>
      </div>

      {/* Left empty by people; filled only by automated form-fillers. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off"
          value={v.website} onChange={(e) => set("website", e.target.value)} />
      </div>

      {error && <p role="alert" className="mt-4 text-[13px] font-medium text-down">{error}</p>}
      <div className="mt-5">
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send application"}</Button>
      </div>
    </form>
  );
}
