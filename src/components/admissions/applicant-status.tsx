"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { respondOffer, payApplicationFee } from "@/app/apply/status/[token]/actions";

export type StatusRow = { child_name: string; class_name: string; school_name: string; status: string; offer_no: string | null; offer_expires_on: string | null;
  waitlist_position: number | null; application_fee: number | null; fee_paid: boolean; online_payment: boolean; slots: { kind: string; at: string; venue: string | null }[];
  year_name: string | null; guardian_name: string };

const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const STATE: Record<string, string> = {
  new: "Received. The school office will contact you.", contacted: "The school office is in touch with you.", visit_scheduled: "A visit is arranged.",
  applied: "Application complete. The school is considering it.", offered: "A seat is offered.", accepted: "You accepted the seat. The office will complete the admission.",
  waitlisted: "On the waiting list.", declined: "The offer is closed.", admitted: "Admitted. Welcome!", not_interested: "This application is closed.",
};

export function ApplicantStatus({ row, token }: { row: StatusRow; token: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const fee = row.application_fee ? Number(row.application_fee) : 0;
  return (
    <div className="space-y-4">
      <div><p className="text-[13px] text-ink-500">{row.school_name}</p><h1 className="t-h1 text-ink-900">Application for {row.child_name}</h1>
        <p className="text-[14px] text-ink-700">{row.class_name}{row.year_name ? `, ${row.year_name}` : ""}</p></div>
      <section className="rounded-md border border-hair bg-white p-4 text-[14px]">
        <p className="font-semibold text-ink-900">{STATE[row.status] ?? row.status}</p>
        {row.status === "waitlisted" && row.waitlist_position && <p className="mt-1 text-ink-700">Place on the waiting list: {row.waitlist_position}. If a seat becomes free, it is offered to you at once and you get a message.</p>}
        {row.status === "offered" && <>
          <p className="mt-1 text-ink-700">Offer {row.offer_no}. Please answer by {dmy(row.offer_expires_on)}; after that the seat goes to the next child on the waiting list.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => start(async () => { const r = await respondOffer(token, true); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh(); })}>Accept the seat</Button>
            {confirm ? <Button variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await respondOffer(token, false); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh(); })}>Yes, decline the seat</Button>
              : <Button variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>Decline</Button>}
          </div>
        </>}
      </section>
      {fee > 0 && <section className="rounded-md border border-hair bg-white p-4 text-[14px]">
        <p className="font-semibold text-ink-900">Application fee: Rs {fee.toLocaleString("en-IN")}</p>
        {row.fee_paid ? <p className="mt-1 text-up">Paid. Thank you.</p> : row.online_payment ? (
          <Button className="mt-2" disabled={pending} onClick={() => start(async () => { const r = await payApplicationFee(token); if (r.ok) window.location.href = r.url; else setMsg({ ok: false, text: r.error }); })}>Pay online</Button>
        ) : <p className="mt-1 text-ink-700">Please pay at the school office.</p>}
      </section>}
      {row.slots.length > 0 && <section className="rounded-md border border-hair bg-white p-4 text-[14px]">
        <p className="font-semibold text-ink-900">Your appointments</p>
        <ul className="mt-1 space-y-1 text-ink-700">{row.slots.map((s, i) => <li key={i}>{s.kind === "test" ? "Entrance test" : "Interview"}: {when(s.at)}{s.venue ? `, ${s.venue}` : ""}</li>)}</ul>
      </section>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[14px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      <p className="text-[12px] text-ink-500">This page is private to you. Do not share the link.</p>
    </div>
  );
}
