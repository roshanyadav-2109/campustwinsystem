"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { prepareIdCards, replaceIdCard } from "@/app/dashboard/students/manage/id-card-actions";
import { downloadIdCards, unprintableNames } from "@/lib/id-card-pdf";

// Print a whole section's ID cards at once (Student records).
export function IdCardsForSection({ sections }: { sections: { id: number; label: string }[] }) {
  const uid = useId();
  const [sectionId, setSectionId] = useState<number | "">(sections[0]?.id ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const label = sections.find((s) => s.id === sectionId)?.label ?? "";
  return (
    <Card>
      <CardHeader title="ID cards" />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-700">Cards are made from the student records: photo, name, class and roll, admission number, date of birth, blood group, a phone to call, and a QR code anyone can scan to check the card. Eight to an A4 sheet, to cut out. Printing again gives the same cards.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48"><Field label="Section" htmlFor={`${uid}-s`}>
            <Select id={`${uid}-s`} value={sectionId} onChange={(e) => setSectionId(Number(e.target.value) || "")}>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field></div>
          <Button disabled={pending || !sectionId} onClick={() => start(async () => {
            setMsg(null);
            const r = await prepareIdCards({ sectionId: Number(sectionId) });
            if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
            await downloadIdCards(r.sheet, `ID cards ${label} ${r.sheet.yearName}`);
            const odd = unprintableNames(r.sheet);
            const noPhoto = r.sheet.cards.filter((c) => !c.photoUrl).length;
            setMsg({ ok: true, text: `${r.sheet.cards.length} cards ready.${noPhoto ? ` ${noPhoto} without a photo (initials shown).` : ""}${odd.length ? ` Names with letters the card cannot print: ${odd.slice(0, 5).join(", ")}.` : ""}` });
          })}>{pending ? "Making cards…" : "Print ID cards"}</Button>
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}

// One student's card (student page): print it, or replace a lost card.
export function IdCardForStudent({ studentId, name, hasCard }: { studentId: number; name: string; hasCard: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => ReturnType<typeof prepareIdCards>, done: string) => start(async () => {
    setMsg(null);
    const r = await fn();
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    await downloadIdCards(r.sheet, `ID card ${name} ${r.sheet.yearName}`);
    setMsg({ ok: true, text: done });
  });
  return (
    <Card>
      <CardHeader title="ID card" />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-700">{hasCard ? "This student has an ID card for this year. Printing again gives the same card." : "No card printed for this year yet."}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => run(() => prepareIdCards({ studentId }), "Card ready.")}>{pending ? "Making card…" : "Print ID card"}</Button>
          {hasCard && <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
            const why = window.prompt("Why is the card being replaced? (lost, damaged ...)");
            if (why) run(() => replaceIdCard(studentId, why), "New card ready. The old card's QR code no longer checks as valid.");
          }}>Card lost or damaged</Button>}
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
