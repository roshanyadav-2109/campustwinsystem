"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { setSeats, saveApplicant, addSlot, signAdmissionDoc, recordAdmissionDoc, admissionDocLink } from "@/app/dashboard/admissions/selection/actions";

export type SeatRow = { class_id: number; class_name: string; seats: number | null; taken: number; available: number | null };
export type SlotRow = { id: number; kind: "test" | "interview"; class_id: number | null; starts_at: string; venue: string | null; capacity: number; used: number };
export type MeritRow = { enquiry_id: number; rank: number; child_name: string; score: number; sibling: boolean; enquired_on: string; status: string; within_seats: boolean };
export type Applicant = { id: number; child_name: string; guardian_name: string; phone: string; status: string; score: number | null; score_note: string | null;
  app_fee_amount: number | null; app_fee_paid_on: string | null; app_fee_ref: string | null; created_at: string;
  docs: { id: number; kind: string }[]; bookings: { slot_id: number; kind: string }[] };

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[12px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ApplicantRow({ a, slots, canEdit }: { a: Applicant; slots: SlotRow[]; canEdit: boolean }) {
  const [score, setScore] = useState(a.score == null ? "" : String(Number(a.score)));
  const [note, setNote] = useState(a.score_note ?? "");
  const [fee, setFee] = useState(a.app_fee_amount == null ? "" : String(Number(a.app_fee_amount)));
  const [feeOn, setFeeOn] = useState(a.app_fee_paid_on ?? "");
  const [feeRef, setFeeRef] = useState(a.app_fee_ref ?? "");
  const [testSlot, setTestSlot] = useState<number | "">(a.bookings.find((b) => b.kind === "test")?.slot_id ?? "");
  const [interviewSlot, setInterviewSlot] = useState<number | "">(a.bookings.find((b) => b.kind === "interview")?.slot_id ?? "");
  const slotOptions = (kind: "test" | "interview", current: number | "") => slots.filter((s) => s.kind === kind).map((s) => (
    <option key={s.id} value={s.id} disabled={s.used >= s.capacity && s.id !== current}>{when(s.starts_at)}{s.venue ? `, ${s.venue}` : ""} ({s.used}/{s.capacity})</option>));
  const [docKind, setDocKind] = useState("Birth certificate");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const c = "h-8 text-[12px]";
  return (
    <tr className="border-t border-hair align-top">
      <td className="px-3 py-2"><p className="font-medium text-ink-900">{a.child_name}</p><p className="text-[11px] text-ink-500">{a.guardian_name}, {a.phone}</p></td>
      <td className="px-2 py-2"><Input className={`${c} w-20`} aria-label={`${a.child_name}: score`} inputMode="decimal" disabled={!canEdit} value={score} onChange={(e) => setScore(e.target.value)} />
        <Input className={`${c} mt-1 w-40`} aria-label={`${a.child_name}: score note`} placeholder="Note" disabled={!canEdit} value={note} onChange={(e) => setNote(e.target.value)} /></td>
      <td className="px-2 py-2"><Input className={`${c} w-24`} aria-label={`${a.child_name}: application fee`} inputMode="decimal" placeholder="Rs" disabled={!canEdit} value={fee} onChange={(e) => setFee(e.target.value)} />
        <Input type="date" className={`${c} mt-1 w-36`} aria-label={`${a.child_name}: fee paid on`} disabled={!canEdit} value={feeOn} onChange={(e) => setFeeOn(e.target.value)} />
        <Input className={`${c} mt-1 w-36`} aria-label={`${a.child_name}: fee receipt`} placeholder="Receipt / UPI ref" disabled={!canEdit} value={feeRef} onChange={(e) => setFeeRef(e.target.value)} /></td>
      <td className="px-2 py-2">
        <Select className={`${c} w-52`} aria-label={`${a.child_name}: test slot`} disabled={!canEdit} value={testSlot} onChange={(e) => setTestSlot(e.target.value ? Number(e.target.value) : "")}>
          <option value="">No test</option>{slotOptions("test", testSlot)}</Select>
        <Select className={`${c} mt-1 w-52`} aria-label={`${a.child_name}: interview slot`} disabled={!canEdit} value={interviewSlot} onChange={(e) => setInterviewSlot(e.target.value ? Number(e.target.value) : "")}>
          <option value="">No interview</option>{slotOptions("interview", interviewSlot)}</Select></td>
      <td className="px-2 py-2 text-[12px]">
        {a.docs.map((d) => <button key={d.id} className="block text-[#0F6CBD] hover:underline" onClick={() => start(async () => { const r = await admissionDocLink(d.id); if (r.ok) window.open(r.url, "_blank"); })}>{d.kind}</button>)}
        {canEdit && (
          <div className="mt-1 flex items-center gap-1">
            <Select className="h-7 w-36 text-[11px]" aria-label={`${a.child_name}: document type`} value={docKind} onChange={(e) => setDocKind(e.target.value)}>
              {["Birth certificate", "Aadhaar", "Previous report card", "Transfer certificate", "Photo", "Caste certificate", "Other"].map((k) => <option key={k}>{k}</option>)}</Select>
            <label className="cursor-pointer rounded-sm border border-hair bg-panel px-2 py-1 text-[11px]">Upload
              <input type="file" className="sr-only" aria-label={`${a.child_name}: upload document`} accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
                start(async () => {
                  const s = await signAdmissionDoc(a.id, f.type, f.size);
                  if (!s.ok) { setMsg({ ok: false, text: s.error }); return; }
                  const put = await fetch(s.uploadUrl, { method: "PUT", body: f, headers: { "Content-Type": f.type } });
                  if (!put.ok) { setMsg({ ok: false, text: "Upload failed." }); return; }
                  const r = await recordAdmissionDoc(a.id, docKind, s.key);
                  setMsg(r.ok ? { ok: true, text: "Uploaded." } : { ok: false, text: r.error });
                  router.refresh();
                });
              }} /></label>
          </div>
        )}
      </td>
      <td className="px-2 py-2">
        {canEdit && <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const r = await saveApplicant(a.id, { score, scoreNote: note, fee, feeOn, feeRef, testSlot: testSlot === "" ? null : testSlot, interviewSlot: interviewSlot === "" ? null : interviewSlot });
          setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error }); if (r.ok) router.refresh();
        })}>Save</Button>}
        <div className="mt-1"><Msg m={msg} /></div>
      </td>
    </tr>
  );
}

export function SelectionDesk({ canEdit, classId, seats, applicants, slots, merit }: { canEdit: boolean; classId: number; seats: SeatRow[]; applicants: Applicant[]; slots: SlotRow[]; merit: MeritRow[] }) {
  const uid = useId();
  const router = useRouter();
  const cur = seats.find((s) => s.class_id === classId);
  const [seatVal, setSeatVal] = useState(cur?.seats == null ? "" : String(cur.seats));
  const [slot, setSlot] = useState({ kind: "test" as "test" | "interview", startsAt: "", venue: "", capacity: "30", forClass: true });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Class">
        {seats.map((s) => (
          <button key={s.class_id} role="tab" aria-selected={s.class_id === classId} onClick={() => router.push(`?class=${s.class_id}`)}
            className={`rounded-sm border px-2.5 py-1 text-[13px] ${s.class_id === classId ? "border-ink-900 bg-ink-900 text-white" : "border-hair bg-white text-ink-700"}`}>
            {s.class_name}{s.seats != null && <span className="ml-1 text-[11px] opacity-80">{s.available} left</span>}</button>
        ))}
      </div>
      <Card>
        <CardHeader title={`Seats in ${cur?.class_name ?? ""}`} action={<Msg m={msg} />} />
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Seats this year (empty = no limit)" htmlFor={`${uid}-s`}><Input id={`${uid}-s`} className="w-28" inputMode="numeric" disabled={!canEdit} value={seatVal} onChange={(e) => setSeatVal(e.target.value)} /></Field>
          {canEdit && <Button disabled={pending} onClick={() => start(async () => { const r = await setSeats(classId, seatVal); setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error }); router.refresh(); })}>Save seats</Button>}
          <span className="text-[13px] text-ink-700">{cur?.taken ?? 0} admitted{cur?.seats != null ? `, ${cur.available} left` : ""}. Admit refuses a child once the class is full.</span>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Merit list" action={<span className="text-[12px] text-ink-500">Higher score first; ties: a brother or sister in the school, then the earlier enquiry</span>} />
        <CardBody className="p-0">
          {merit.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">Enter scores to see the merit list.</p> : (
            <table className="w-full text-[13px]">
              <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Rank</th><th className="px-4 py-2 font-medium">Child</th><th className="px-4 py-2 text-right font-medium">Score</th><th className="px-4 py-2 font-medium">Sibling</th><th className="px-4 py-2 font-medium">Seat</th></tr></thead>
              <tbody>{merit.map((m) => (
                <tr key={m.enquiry_id} className="border-t border-hair"><td className="px-4 py-1.5 tabular">{m.rank}</td><td className="px-4 py-1.5">{m.child_name}</td><td className="px-4 py-1.5 text-right tabular">{Number(m.score)}</td>
                  <td className="px-4 py-1.5">{m.sibling ? "Yes" : ""}</td><td className="px-4 py-1.5">{m.within_seats ? <span className="text-up">Within seats</span> : <span className="text-ink-500">Waiting list</span>}</td></tr>))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`Applicants (${applicants.length})`} />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-[13px]">
              <thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-3 py-2 font-medium">Child</th><th className="px-2 py-2 font-medium">Score</th><th className="px-2 py-2 font-medium">Application fee</th><th className="px-2 py-2 font-medium">Test / interview</th><th className="px-2 py-2 font-medium">Documents</th><th /></tr></thead>
              <tbody>{applicants.map((a) => <ApplicantRow key={a.id} a={a} slots={slots} canEdit={canEdit} />)}</tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      {canEdit && (
        <Card>
          <CardHeader title="Add a test or interview slot" />
          <CardBody className="flex flex-wrap items-end gap-3">
            <Field label="Kind" htmlFor={`${uid}-k`}><Select id={`${uid}-k`} value={slot.kind} onChange={(e) => setSlot({ ...slot, kind: e.target.value as "test" | "interview" })}><option value="test">Entrance test</option><option value="interview">Interview</option></Select></Field>
            <Field label="Date and time" htmlFor={`${uid}-t`}><Input id={`${uid}-t`} type="datetime-local" value={slot.startsAt} onChange={(e) => setSlot({ ...slot, startsAt: e.target.value })} /></Field>
            <Field label="Venue" htmlFor={`${uid}-v`}><Input id={`${uid}-v`} value={slot.venue} onChange={(e) => setSlot({ ...slot, venue: e.target.value })} /></Field>
            <Field label="Places" htmlFor={`${uid}-c`}><Input id={`${uid}-c`} className="w-20" inputMode="numeric" value={slot.capacity} onChange={(e) => setSlot({ ...slot, capacity: e.target.value })} /></Field>
            <label className="flex items-center gap-1.5 pb-2 text-[13px]"><input type="checkbox" checked={slot.forClass} onChange={(e) => setSlot({ ...slot, forClass: e.target.checked })} className="h-4 w-4 accent-[#0F6CBD]" />Only for {cur?.class_name}</label>
            <Button disabled={pending} onClick={() => start(async () => { const r = await addSlot({ kind: slot.kind, classId: slot.forClass ? classId : null, startsAt: slot.startsAt, venue: slot.venue, capacity: slot.capacity }); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Add slot</Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
