"use client";
import { useEffect, useId, useState, useTransition } from "react";
import Link from "@/components/ui/hover-link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { addFollowup, admitEnquiry, getAdmitOptions, updateEnquiry, makeOffer, waitlistApplication, withdrawOffer, offerLetterData } from "@/app/dashboard/admissions/actions";
import { downloadPdf } from "@/lib/pdf";
import { offerLetterPdf } from "@/components/admissions/offer-letter";
import {
  LIMITS, SOURCE_LABEL, STATUSES, STATUS_LABEL, fmtDate, type Enquiry, type Followup, type StaffRef,
} from "@/components/admissions/shared";

const OFFER_STATUSES: string[] = ["offered", "accepted", "waitlisted", "declined"];

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="t-label">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px] text-ink-900">{children}</dd>
    </div>
  );
}

// Everything about one enquiry. The office can change the status, the person
// looking after it and the follow-up date, and add notes; the principal reads.
export function EnquiryDetail({
  enquiry, followups, staff, canEdit, onSaved,
}: {
  enquiry: Enquiry;
  followups: Followup[];
  staff: StaffRef[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const id = useId();
  const [status, setStatus] = useState<string>(enquiry.status);
  const [assignedTo, setAssignedTo] = useState<string>(enquiry.assignedTo ? String(enquiry.assignedTo) : "");
  const [nextFollowUp, setNextFollowUp] = useState<string>(enquiry.nextFollowUp ?? "");
  const [note, setNote] = useState("");
  const [noteNext, setNoteNext] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean; where: "main" | "note" } | null>(null);
  const [pending, start] = useTransition();

  const changed =
    status !== enquiry.status ||
    assignedTo !== (enquiry.assignedTo ? String(enquiry.assignedTo) : "") ||
    nextFollowUp !== (enquiry.nextFollowUp ?? "");

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateEnquiry(enquiry.id, { status, assignedTo: Number(assignedTo) || null, nextFollowUp });
      if (!res.ok) { setMsg({ text: res.error, ok: false, where: "main" }); return; }
      setMsg({ text: "Saved.", ok: true, where: "main" });
      onSaved();
    });
  }

  function saveNote() {
    setMsg(null);
    start(async () => {
      const res = await addFollowup(enquiry.id, { note, nextFollowUp: noteNext });
      if (!res.ok) { setMsg({ text: res.error, ok: false, where: "note" }); return; }
      if (noteNext) setNextFollowUp(noteNext);
      setNote(""); setNoteNext("");
      setMsg({ text: "Note added.", ok: true, where: "note" });
      onSaved();
    });
  }

  const showAdmittedHint = status === "admitted" || enquiry.status === "admitted";

  return (
    <div className="space-y-6">
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
        <Detail label="Child">{enquiry.childName}</Detail>
        <Detail label="Date of birth">{fmtDate(enquiry.dateOfBirth)}</Detail>
        <Detail label="Class sought">{enquiry.className}</Detail>
        <Detail label="Parent or guardian">{enquiry.guardianName}</Detail>
        <Detail label="Phone"><span className="tabular">{enquiry.phone}</span></Detail>
        <Detail label="Email">{enquiry.email ?? "—"}</Detail>
        <Detail label="Previous school">{enquiry.previousSchool ?? "—"}</Detail>
        <Detail label="Source">{SOURCE_LABEL[enquiry.source]}</Detail>
        <Detail label="Received on">{fmtDate(enquiry.createdAt)}</Detail>
        <div className="sm:col-span-3"><Detail label="Address">{enquiry.address ?? "—"}</Detail></div>
        {enquiry.message && (
          <div className="sm:col-span-3">
            <Detail label={enquiry.source === "online" ? "Message from the family" : "Note"}>
              <span className="whitespace-pre-wrap">{enquiry.message}</span>
            </Detail>
          </div>
        )}
      </dl>

      <section className="border-t border-hair pt-4">
        <h3 className="t-h3 text-ink-900">Status and follow-up</h3>
        {canEdit ? (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Status" htmlFor={`${id}-status`}>
                <Select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.filter((s) => !OFFER_STATUSES.includes(s) || s === enquiry.status).map((s) => <option key={s} value={s} disabled={OFFER_STATUSES.includes(s)}>{STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field label="Assigned to" htmlFor={`${id}-assign`}>
                <Select id={`${id}-assign`} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="">No one yet</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Next follow-up" htmlFor={`${id}-next`}>
                <Input id={`${id}-next`} type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={pending || !changed}>{pending ? "Saving…" : "Save"}</Button>
              {msg?.where === "main" && (
                <span role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>
              )}
            </div>
          </>
        ) : (
          <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-3">
            <Detail label="Status">{STATUS_LABEL[enquiry.status]}</Detail>
            <Detail label="Assigned to">{enquiry.assignedName ?? "No one yet"}</Detail>
            <Detail label="Next follow-up">{fmtDate(enquiry.nextFollowUp)}</Detail>
          </dl>
        )}
        {enquiry.studentId ? (
          <p className="mt-3 rounded-sm border border-hair bg-panel px-3 py-2 text-[13px] text-ink-700">
            Admitted. The student and parent records were created.{" "}
            <Link href="/dashboard/students/manage" className="font-medium text-[#0F6CBD] hover:underline">Open Students</Link>
          </p>
        ) : canEdit && enquiry.status !== "not_interested" ? (
          <>
            <OfferPanel enquiry={enquiry} onDone={onSaved} />
            <AdmitPanel enquiry={enquiry} onDone={onSaved} />
          </>
        ) : showAdmittedHint ? (
          <p className="mt-3 rounded-sm border border-hair bg-panel px-3 py-2 text-[13px] text-ink-700">
            Marked admitted before automatic admission was available. Add the student in{" "}
            <Link href="/dashboard/students/manage" className="font-medium text-[#0F6CBD] hover:underline">Students, Manage records</Link>.
          </p>
        ) : null}
      </section>

      <section className="border-t border-hair pt-4">
        <h3 className="t-h3 text-ink-900">Follow-up notes</h3>
        {canEdit && (
          <div className="mt-3 space-y-3">
            <Field label="New note" htmlFor={`${id}-note`}>
              <Textarea id={`${id}-note`} rows={2} value={note} maxLength={LIMITS.note}
                placeholder="What was discussed on the call or visit" onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Field label="Follow up again on" htmlFor={`${id}-note-next`}>
                  <Input id={`${id}-note-next`} type="date" value={noteNext} onChange={(e) => setNoteNext(e.target.value)} />
                </Field>
              </div>
              <Button variant="subtle" onClick={saveNote} disabled={pending || !note.trim()}>{pending ? "Saving…" : "Add note"}</Button>
              {msg?.where === "note" && (
                <span role={msg.ok ? "status" : "alert"} className={`pb-2.5 text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>
              )}
            </div>
          </div>
        )}
        {followups.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-500">No follow-up notes yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-hair border-t border-hair">
            {followups.map((f) => (
              <li key={f.id} className="py-2.5">
                <div className="text-[12px] text-ink-500">
                  {fmtDate(f.createdAt)} · {f.byName}
                  {f.nextFollowUp && <> · next follow-up {fmtDate(f.nextFollowUp)}</>}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] text-ink-900">{f.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Offer a seat (held until a date), put on the waiting list, or withdraw an offer; the letter and the family's link.
function OfferPanel({ enquiry, onDone }: { enquiry: Enquiry; onDone: () => void }) {
  const [until, setUntil] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [link, setLink] = useState("");
  useEffect(() => { setLink(enquiry.publicToken ? `${window.location.origin}/apply/status/${enquiry.publicToken}` : ""); }, [enquiry.publicToken]);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) onDone(); });
  const open = enquiry.status === "offered" || enquiry.status === "accepted";
  return (
    <div className="mt-3 rounded-md border border-hair bg-white px-4 py-3 text-[13px]">
      <h4 className="text-[14px] font-semibold text-ink-900">Offer and waiting list</h4>
      {open ? <p className="mt-1 text-ink-700">Offer {enquiry.offerNo}{enquiry.status === "accepted" ? ", accepted by the family" : `, open until ${fmtDate(enquiry.offerExpiresOn)}`}.</p>
        : enquiry.status === "waitlisted" ? <p className="mt-1 text-ink-700">On the waiting list. A seat that becomes free is offered automatically, best score first.</p>
        : enquiry.status === "declined" ? <p className="mt-1 text-ink-700">Offer closed{enquiry.decisionNote ? `: ${enquiry.decisionNote}` : ""}.</p> : null}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {!open && <>
          <label className="text-[12px] text-ink-700">Open until<Input type="date" className="mt-1 h-8 w-40 text-[12px]" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Offer open until" /></label>
          <Button size="sm" disabled={pending} onClick={() => run(() => makeOffer(enquiry.id, until), "Seat offered. The family is told.")}>Offer a seat</Button>
          {enquiry.status !== "waitlisted" && <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(() => waitlistApplication(enquiry.id), "On the waiting list. The family is told.")}>Waiting list</Button>}
        </>}
        {open && <>
          <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const d = await offerLetterData(enquiry.id); if (!d) { setMsg({ ok: false, text: "No offer to print." }); return; } await downloadPdf(offerLetterPdf(d, link)); })}>Offer letter</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawOffer(enquiry.id, ""), "Offer withdrawn; the seat goes to the waiting list.")}>Withdraw offer</Button>
        </>}
        {link && <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(link); setMsg({ ok: true, text: "The family's link is copied." }); }}>Copy family link</Button>}
        {!enquiry.feePaid && <span className="text-[12px] text-ink-500">Application fee not paid yet</span>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-[12px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
    </div>
  );
}

// One step from enquiry to student: pick the section, confirm the suggested
// admission number, and the student, parent and class place are created.
function AdmitPanel({ enquiry, onDone }: { enquiry: Enquiry; onDone: () => void }) {
  const id = useId();
  const [opts, setOpts] = useState<{ sections: { id: number; name: string }[] } | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    getAdmitOptions(enquiry.id).then((r) => {
      if (!live) return;
      if (!r.ok) { setMsg({ text: r.error, ok: false }); return; }
      setOpts({ sections: r.sections });
      if (r.sections[0]) setSectionId(String(r.sections[0].id));
      setAdmissionNo(r.suggestedAdmissionNo);
    });
    return () => { live = false; };
  }, [enquiry.id]);

  function admit() {
    setMsg(null);
    start(async () => {
      const res = await admitEnquiry(enquiry.id, { sectionId: Number(sectionId), admissionNo, rollNo });
      if (!res.ok) { setMsg({ text: res.error, ok: false }); onDone(); return; }
      setMsg({ text: `${enquiry.childName} is now a student.`, ok: true });
      onDone();
    });
  }

  return (
    <div className="mt-4 rounded-sm border border-hair p-3">
      <h4 className="text-[14px] font-semibold text-ink-900">Admit {enquiry.childName}</h4>
      <p className="mt-0.5 text-[13px] text-ink-500">Creates the student, the parent ({enquiry.guardianName}) and their place in {enquiry.className}. The parent can then sign in with Google{enquiry.email ? ` as ${enquiry.email}` : " once an email is added"}.</p>
      {!opts ? (
        <p className="mt-3 text-[13px] text-ink-500">{msg ? "" : "Loading…"}</p>
      ) : opts.sections.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-700">{enquiry.className} has no sections yet. Add one in <Link href="/dashboard/settings/classes" className="font-medium text-[#0F6CBD] hover:underline">Settings, Classes and subjects</Link>.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Section" htmlFor={`${id}-sec`}>
            <Select id={`${id}-sec`} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {opts.sections.map((sec) => <option key={sec.id} value={sec.id}>{enquiry.className} {sec.name}</option>)}
            </Select>
          </Field>
          <Field label="Admission no" htmlFor={`${id}-adm`}>
            <Input id={`${id}-adm`} value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} />
          </Field>
          <Field label="Roll no (optional)" htmlFor={`${id}-roll`}>
            <Input id={`${id}-roll`} inputMode="numeric" value={rollNo} onChange={(e) => setRollNo(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {opts && opts.sections.length > 0 && (
          <Button onClick={admit} disabled={pending || !sectionId || !admissionNo.trim()}>{pending ? "Admitting…" : "Admit and create student"}</Button>
        )}
        {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
