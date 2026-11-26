"use client";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/students/student-form";
import { saveStudentIdentity, saveStudentProfile } from "@/app/dashboard/students/[id]/actions";
import type { StudentIdentity, StudentProfile } from "@/lib/data/student-record";

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const CATEGORY: [string, string][] = [["general", "General"], ["sc", "SC"], ["st", "ST"], ["obc", "OBC"], ["ews", "EWS"]];

// Edit the everyday profile: admission, address, medical and emergency details.
export function EditProfileButton({ studentId, profile }: { studentId: number; profile: StudentProfile }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<StudentProfile>(profile);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof StudentProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value || null });
  const v = (k: keyof StudentProfile) => f[k] ?? "";
  const input = (k: keyof StudentProfile, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} htmlFor={`${uid}-${k}`}><Input id={`${uid}-${k}`} value={v(k)} onChange={set(k)} {...props} /></Field>
  );
  const save = () => start(async () => {
    setError(null);
    const res = await saveStudentProfile(studentId, f);
    if (res.ok) setOpen(false); else setError(res.error);
  });
  return (
    <>
      <Button size="sm" variant="subtle" onClick={() => { setF(profile); setOpen(true); }}>Edit details</Button>
      {open && (
        <Dialog title="Student details" onClose={() => setOpen(false)}>
          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1 text-left">
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-[13px] font-semibold text-ink-900">Admission and personal</legend>
              {input("admission_date", "Date of admission", { type: "date" })}
              {input("admitted_class", "Class at admission", { maxLength: 40 })}
              {input("previous_school", "Previous school", { maxLength: 160 })}
              {input("place_of_birth", "Place of birth", { maxLength: 80 })}
              {input("nationality", "Nationality", { maxLength: 40, placeholder: "Indian" })}
              {input("mother_tongue", "Mother tongue", { maxLength: 40 })}
              <Field label="Blood group" htmlFor={`${uid}-bg`}>
                <Select id={`${uid}-bg`} value={v("blood_group")} onChange={set("blood_group")}>
                  <option value="">Not known</option>{BLOOD.map((b) => <option key={b}>{b}</option>)}
                </Select>
              </Field>
              {input("house", "House", { maxLength: 40 })}
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-[13px] font-semibold text-ink-900">Address</legend>
              <div className="sm:col-span-2">{input("address_line", "Address", { maxLength: 240 })}</div>
              {input("city", "City or town", { maxLength: 80 })}
              {input("state", "State", { maxLength: 60 })}
              {input("pincode", "PIN code", { inputMode: "numeric", maxLength: 6 })}
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-[13px] font-semibold text-ink-900">Medical and emergency</legend>
              <div className="sm:col-span-2"><Field label="Allergies" htmlFor={`${uid}-al`}><Textarea id={`${uid}-al`} rows={2} maxLength={300} value={v("allergies")} onChange={set("allergies")} /></Field></div>
              <div className="sm:col-span-2"><Field label="Medical notes" htmlFor={`${uid}-mn`}><Textarea id={`${uid}-mn`} rows={2} maxLength={500} value={v("medical_notes")} onChange={set("medical_notes")} /></Field></div>
              {input("emergency_name", "Emergency contact", { maxLength: 80 })}
              {input("emergency_phone", "Emergency phone", { inputMode: "tel", maxLength: 20 })}
            </fieldset>
          </div>
          {error && <p role="alert" className="mt-3 text-left text-[13px] text-down">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

// Edit identity and category details (office and principal only).
export function EditIdentityButton({ studentId, identity }: { studentId: number; identity: StudentIdentity }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(identity);
  const [aadhaar, setAadhaar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    setError(null);
    const res = await saveStudentIdentity(studentId, { ...f, aadhaar: aadhaar || f.aadhaar_last4 || "" });
    if (res.ok) setOpen(false); else setError(res.error);
  });
  return (
    <>
      <Button size="sm" variant="subtle" onClick={() => { setF(identity); setAadhaar(""); setOpen(true); }}>Edit</Button>
      {open && (
        <Dialog title="Identity and category" onClose={() => setOpen(false)}>
          <div className="grid gap-3 text-left sm:grid-cols-2">
            <Field label="APAAR ID" htmlFor={`${uid}-ap`} hint="12 digits"><Input id={`${uid}-ap`} inputMode="numeric" maxLength={14} value={f.apaar_id ?? ""} onChange={(e) => setF({ ...f, apaar_id: e.target.value })} /></Field>
            <Field label="PEN (UDISE+)" htmlFor={`${uid}-pen`} hint="11 digits"><Input id={`${uid}-pen`} inputMode="numeric" maxLength={13} value={f.pen ?? ""} onChange={(e) => setF({ ...f, pen: e.target.value })} /></Field>
            <Field label="Aadhaar" htmlFor={`${uid}-ad`} hint={f.aadhaar_last4 ? `Saved: ending ${f.aadhaar_last4}. Only the last 4 digits are kept.` : "Only the last 4 digits are kept."}>
              <Input id={`${uid}-ad`} inputMode="numeric" maxLength={14} placeholder={f.aadhaar_last4 ? `•••• •••• ${f.aadhaar_last4}` : ""} value={aadhaar} onChange={(e) => setAadhaar(e.target.value)} />
            </Field>
            <Field label="Category" htmlFor={`${uid}-cat`}>
              <Select id={`${uid}-cat`} value={f.category ?? ""} onChange={(e) => setF({ ...f, category: e.target.value || null })}>
                <option value="">Not recorded</option>{CATEGORY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Religion" htmlFor={`${uid}-rel`}><Input id={`${uid}-rel`} maxLength={40} value={f.religion ?? ""} onChange={(e) => setF({ ...f, religion: e.target.value })} /></Field>
            <div className="space-y-2 pt-6">
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={f.bpl} onChange={(e) => setF({ ...f, bpl: e.target.checked })} /> Below poverty line</label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={f.special_needs} onChange={(e) => setF({ ...f, special_needs: e.target.checked })} /> Child with special needs</label>
            </div>
            {f.special_needs && <div className="sm:col-span-2"><Field label="Special needs, in short" htmlFor={`${uid}-sn`}><Input id={`${uid}-sn`} maxLength={200} value={f.special_needs_note ?? ""} onChange={(e) => setF({ ...f, special_needs_note: e.target.value })} /></Field></div>}
          </div>
          {error && <p role="alert" className="mt-3 text-left text-[13px] text-down">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
