"use client";
import { useActionState } from "react";
import { grantSchoolLogin, type LoginResult } from "@/app/console/actions";
import { inputCls, labelCls, btnPrimary } from "./ui";

// Lets the platform owner give a school its first principal or office login,
// so a new school can start without anyone running a script.
export function FirstLoginForm({ schoolId }: { schoolId: number }) {
  const [state, action, pending] = useActionState<LoginResult, FormData>(grantSchoolLogin, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="schoolId" value={schoolId} />
      <div><label className={labelCls} htmlFor="fl-name">Full name</label><input id="fl-name" name="name" required className={inputCls} /></div>
      <div><label className={labelCls} htmlFor="fl-email">Google email</label><input id="fl-email" name="email" type="email" required className={inputCls} placeholder="name@gmail.com" /></div>
      <div>
        <label className={labelCls} htmlFor="fl-role">Signs in as</label>
        <select id="fl-role" name="role" defaultValue="office" className={inputCls}>
          <option value="office">School office</option>
          <option value="principal">Principal</option>
        </select>
      </div>
      {state && <p role="status" className={`text-[13px] ${state.ok ? "text-cx-ok" : "text-cx-bad"}`}>{state.message}</p>}
      <div className="flex justify-end"><button className={btnPrimary} disabled={pending}>{pending ? "Saving" : "Give access"}</button></div>
    </form>
  );
}
