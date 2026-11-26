"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ReportIcon } from "@/components/icons";
import { downloadPdf } from "@/lib/pdf";
import { decideFeeLetter, previewFeeLetter, requestFeeLetter } from "@/app/dashboard/fees/actions";
import { PURPOSE_LABEL, feeLetterPdf, fmtDay, fmtMoney, type FeeLetterContent, type FeeLetterPurpose, type FeeLetterRequest } from "@/components/fees/shared";

const ERR = "text-[13px] text-down";
const OK = "text-[13px] font-medium text-up";
const day = (iso: string) => fmtDay(iso.slice(0, 10));

export function FeeLetterDownload({ letter }: { letter: FeeLetterRequest }) {
  const [busy, setBusy] = useState(false);
  if (letter.status !== "issued" || !letter.content || !letter.letterNo) return null;
  return (
    <Button size="sm" variant="subtle" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await downloadPdf(feeLetterPdf({ letterNo: letter.letterNo!, issuedOn: (letter.decidedAt ?? letter.createdAt).slice(0, 10), purpose: letter.purpose, addressedTo: letter.addressedTo, content: letter.content! })); }
      finally { setBusy(false); }
    }}><ReportIcon size={16} /> {busy ? "Making PDF" : "Download letter"}</Button>
  );
}

const statusText = (l: FeeLetterRequest) =>
  l.status === "pending" ? "With the school office" : l.status === "issued" ? `Ready, letter no. ${l.letterNo}` : "Not issued";

// ---------------------------------------------------------------------------
// Parent or student: ask for a letter, see what the office did
// ---------------------------------------------------------------------------
export function FamilyFeeLetters({ studentId, letters }: { studentId: number; letters: FeeLetterRequest[] }) {
  const uid = useId();
  const open = letters.find((l) => l.status === "pending");
  const [asking, setAsking] = useState(false);
  const [purpose, setPurpose] = useState<FeeLetterPurpose>("education_loan");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const send = () => {
    setMsg(null);
    start(async () => {
      const res = await requestFeeLetter({ studentId, purpose, addressedTo: to, note });
      if (res.ok) { setAsking(false); setTo(""); setNote(""); setMsg({ ok: true, text: "Request sent. The school office will check it and share the letter here." }); }
      else setMsg({ ok: false, text: res.error });
    });
  };
  return (
    <Card>
      <CardHeader title="Fee letter" action={!open && !asking && <Button size="sm" variant="subtle" onClick={() => { setAsking(true); setMsg(null); }}>Ask for a fee letter</Button>} />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-700">A letter from the school with this year&apos;s fees, for an education loan, a visa or your employer. The school office checks it before sharing it with you.</p>
        {asking && (
          <div className="space-y-3 rounded-sm border border-hair p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What is it for" htmlFor={`${uid}-p`}>
                <Select id={`${uid}-p`} value={purpose} onChange={(e) => setPurpose(e.target.value as FeeLetterPurpose)}>
                  {(Object.keys(PURPOSE_LABEL) as FeeLetterPurpose[]).map((k) => <option key={k} value={k}>{PURPOSE_LABEL[k]}</option>)}
                </Select>
              </Field>
              <Field label={purpose === "education_loan" ? "Bank or loan company" : "Addressed to (optional)"} htmlFor={`${uid}-t`}>
                <Input id={`${uid}-t`} value={to} maxLength={120} placeholder={purpose === "education_loan" ? "For example, State Bank of India, Baner branch" : ""} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <Field label="Anything the office should know (optional)" htmlFor={`${uid}-n`}>
              <Textarea id={`${uid}-n`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button disabled={pending || (purpose === "education_loan" && !to.trim())} onClick={send}>{pending ? "Sending…" : "Send request"}</Button>
              <Button variant="ghost" disabled={pending} onClick={() => setAsking(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? OK : ERR}>{msg.text}</p>}
        {letters.length > 0 && (
          <ul>
            {letters.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-hair py-2">
                <div>
                  <div className="text-[14px] text-ink-900">{PURPOSE_LABEL[l.purpose]}{l.addressedTo ? `, ${l.addressedTo}` : ""}</div>
                  <div className="text-[12px] text-ink-500">Asked on {day(l.createdAt)} · {statusText(l)}{l.officeNote ? ` · ${l.officeNote}` : ""}</div>
                </div>
                <FeeLetterDownload letter={l} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Office: check, then issue or decline
// ---------------------------------------------------------------------------
function Summary({ c }: { c: FeeLetterContent }) {
  return (
    <div className="grid gap-4 text-[13px] lg:grid-cols-2">
      <table className="w-full">
        <tbody>
          {c.heads.map((h) => <tr key={h.name} className="border-b border-hair"><td className="py-1">{h.name}</td><td className="py-1 text-right tabular">{fmtMoney(h.amount)}</td></tr>)}
          {c.transport && <tr className="border-b border-hair"><td className="py-1">{c.transport.label}</td><td className="py-1 text-right tabular">{fmtMoney(c.transport.amount)}</td></tr>}
          {c.concessions.map((k) => <tr key={k.name} className="border-b border-hair"><td className="py-1">Less: {k.name}</td><td className="py-1 text-right tabular">-{fmtMoney(k.amount)}</td></tr>)}
          <tr><td className="py-1 font-semibold">Total for {c.year.name}</td><td className="py-1 text-right font-semibold tabular">{fmtMoney(c.total)}</td></tr>
        </tbody>
      </table>
      <div>
        {c.instalments.length > 0 ? (
          <table className="w-full"><tbody>
            {c.instalments.map((i) => <tr key={i.name} className="border-b border-hair"><td className="py-1">{i.name}</td><td className="py-1 tabular">{fmtDay(i.dueDate)}</td><td className="py-1 text-right tabular">{fmtMoney(i.amount)}</td></tr>)}
          </tbody></table>
        ) : <p className="text-ink-500">No instalments set for the year.</p>}
        <p className="mt-2 text-ink-700">Paid so far {fmtMoney(c.paid)} · still to pay {fmtMoney(c.balance)}</p>
        {c.parents.length > 0 && <p className="mt-1 text-ink-500">Parents: {c.parents.join(", ")}</p>}
      </div>
    </div>
  );
}

function PendingLetter({ letter }: { letter: FeeLetterRequest }) {
  const uid = useId();
  const [content, setContent] = useState<FeeLetterContent | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const look = () => start(async () => { setMsg(null); const r = await previewFeeLetter(letter.id); if (r.ok) setContent(r.content); else setMsg(r.error); });
  const decide = (issue: boolean) => start(async () => { setMsg(null); const r = await decideFeeLetter({ id: letter.id, issue, officeNote: note }); if (!r.ok) setMsg(r.error); });
  return (
    <li className="space-y-3 border-t border-hair py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[14px] text-ink-900"><span className="font-medium">{letter.studentName}</span> <span className="text-ink-500">{letter.classLabel}</span></div>
          <div className="text-[12px] text-ink-500">{PURPOSE_LABEL[letter.purpose]}{letter.addressedTo ? `, ${letter.addressedTo}` : ""} · asked by {letter.requestedName ?? "the family"} on {day(letter.createdAt)}</div>
          {letter.note && <div className="text-[12px] text-ink-700">“{letter.note}”</div>}
        </div>
        {!content && <Button size="sm" disabled={pending} onClick={look}>{pending ? "Loading…" : "Check the letter"}</Button>}
      </div>
      {content && (
        <div className="space-y-3 rounded-sm border border-hair p-3">
          <Summary c={content} />
          <Field label="Note to the family (needed if you do not issue it)" htmlFor={`${uid}-n`}>
            <Input id={`${uid}-n`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => decide(true)}>Issue and share</Button>
            <Button variant="ghost" disabled={pending} onClick={() => decide(false)}>Do not issue</Button>
          </div>
          <p className="text-[12px] text-muted">The figures are taken as they are now and kept with the letter. If something is wrong, correct the fee setup first.</p>
        </div>
      )}
      {msg && <p role="alert" className={ERR}>{msg}</p>}
    </li>
  );
}

export function OfficeFeeLetters({ letters }: { letters: FeeLetterRequest[] }) {
  const waiting = letters.filter((l) => l.status === "pending");
  const done = letters.filter((l) => l.status !== "pending");
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={`Waiting for the office (${waiting.length})`} />
        <CardBody>
          {waiting.length === 0 ? <p className="text-[13px] text-ink-500">No requests waiting. Parents ask for fee letters from their fees page.</p>
            : <ul>{waiting.map((l) => <PendingLetter key={l.id} letter={l} />)}</ul>}
        </CardBody>
      </Card>
      {done.length > 0 && (
        <Card>
          <CardHeader title="Issued and declined" />
          <CardBody>
            <ul>{done.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-hair py-2 first:border-0">
                <div>
                  <div className="text-[14px] text-ink-900"><span className="font-medium">{l.studentName}</span> <span className="text-ink-500">{l.classLabel}</span></div>
                  <div className="text-[12px] text-ink-500">{PURPOSE_LABEL[l.purpose]}{l.addressedTo ? `, ${l.addressedTo}` : ""} · {l.status === "issued" ? `issued ${l.letterNo} on ${day(l.decidedAt ?? l.createdAt)}` : `not issued: ${l.officeNote ?? ""}`}</div>
                </div>
                <FeeLetterDownload letter={l} />
              </li>
            ))}</ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
