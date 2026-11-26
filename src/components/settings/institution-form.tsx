"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { saveInstitutionDetails, type InstitutionDetails } from "@/app/dashboard/settings/institution/actions";

const BOARDS = ["CBSE", "CISCE (ICSE / ISC)", "State board", "IB", "Cambridge (CAIE)", "NIOS", "University", "Other"];

export function InstitutionForm({ initial, name, higherEd }: { initial: InstitutionDetails; name: string; higherEd: boolean }) {
  const uid = useId();
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const field = (k: keyof InstitutionDetails, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field label={label} htmlFor={`${uid}-${k}`} hint={hint}><Input id={`${uid}-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Field>
  );
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Contact details" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="mb-3 text-[13px] text-ink-700">The name <strong>{name}</strong>, logo and colours are set by Eternity. Ask us to change them.</p>
            {field("address", "Full address", { maxLength: 300 })}
          </div>
          {field("phone", "Phone", { inputMode: "tel", maxLength: 40 })}
          {field("email", "Email", { type: "email", maxLength: 120 })}
          {field("website", "Website", { maxLength: 120, placeholder: "www.example.edu.in" })}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={higherEd ? "Affiliation and codes" : "Board and codes"} />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label={higherEd ? "Affiliated to" : "Board"} htmlFor={`${uid}-board`}>
            <Select id={`${uid}-board`} value={BOARDS.includes(f.affiliation_board) || !f.affiliation_board ? f.affiliation_board : "Other"} onChange={(e) => setF({ ...f, affiliation_board: e.target.value })}>
              <option value="">Not set</option>{BOARDS.map((b) => <option key={b}>{b}</option>)}
            </Select>
          </Field>
          {field("affiliation_no", "Affiliation number", { maxLength: 40 })}
          {field("board_school_code", higherEd ? "College code" : "School code (board)", { maxLength: 20 })}
          {!higherEd && field("udise_code", "UDISE+ code", { inputMode: "numeric", maxLength: 13 }, "11 digits")}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Who signs certificates" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {field("signatory_name", "Name", { maxLength: 80 })}
          {field("signatory_title", "Title", { maxLength: 60, placeholder: "Principal" })}
        </CardBody>
      </Card>
      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={() => start(async () => { const r = await saveInstitutionDetails(f); setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error }); })}>{pending ? "Saving…" : "Save"}</Button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
