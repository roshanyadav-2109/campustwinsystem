"use client";
import { useId, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { saveSignInDomains } from "@/app/dashboard/settings/access/actions";

// Colleges and universities often allow only their own email addresses;
// schools usually leave this empty so parents can use any email.
export function SignInDomains({ domains, higherEd }: { domains: string[]; higherEd: boolean }) {
  const uid = useId();
  const [value, setValue] = useState(domains.join(", "));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader title="Who can sign in" />
      <CardBody className="space-y-3">
        <p className="text-[13px] text-ink-700">
          {higherEd
            ? "If everyone has an institutional email, enter its domain so only those addresses can sign in."
            : "Leave this empty so parents and staff can sign in with any email on their record. Fill it in only if everyone has a school email."}
        </p>
        <Field label="Allowed email domains (optional)" htmlFor={`${uid}-d`} hint="For example: college.edu.in. Separate several with commas.">
          <Input id={`${uid}-d`} value={value} placeholder="Any email" onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button disabled={pending} onClick={() => start(async () => { const r = await saveSignInDomains(value); setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error }); })}>{pending ? "Saving…" : "Save"}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
