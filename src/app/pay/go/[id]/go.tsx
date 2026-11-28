"use client";
import { useEffect, useRef, useState } from "react";
import type { Step } from "@/core/payments/hosted";

// Sends the payer on to the gateway: an auto-submitted form, or Cashfree's own checkout script.
export function GoToGateway({ step, amountText, school, student, gateway, cancelHref, test }: { step: Exclude<Step, { kind: "redirect" }>; amountText: string; school: string; student: string; gateway: string; cancelHref: string; test: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    if (step.kind === "post") { form.current?.submit(); return; }
    const cf = (window as unknown as { Cashfree?: (o: { mode: string }) => { checkout(o: { paymentSessionId: string; redirectTarget: string }): Promise<unknown> } }).Cashfree;
    if (!cf) { setError("The payment page could not load. Check your connection and try again."); return; }
    void cf({ mode: step.mode }).checkout({ paymentSessionId: step.sessionId, redirectTarget: "_self" });
  };
  useEffect(() => {
    if (step.kind === "post") { form.current?.submit(); return; }
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.onload = go;
    s.onerror = () => setError("The payment page could not load. Check your connection and try again.");
    document.body.appendChild(s);
    return () => { s.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="rounded-md border border-hair bg-white p-6 text-center">
      <p className="text-[13px] text-ink-500">{school}</p>
      <h1 className="mt-1 text-[22px] font-semibold text-ink-900">{amountText}</h1>
      <p className="mt-1 text-[13px] text-ink-700">For {student}{test ? " (test payment: no real money)" : ""}</p>
      <p className="mt-3 text-[13px] text-ink-700">Taking you to {gateway}…</p>
      {error && <p role="alert" className="mt-2 text-[13px] text-down">{error}</p>}
      {step.kind === "post" && (
        <form ref={form} method="POST" action={step.action}>
          {Object.entries(step.fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <noscript><button type="submit" className="mt-4 h-10 w-full rounded-md bg-ink-900 text-[14px] font-medium text-white">Continue to {gateway}</button></noscript>
        </form>
      )}
      <button type="button" onClick={go} className="mt-4 h-10 w-full rounded-md bg-ink-900 text-[14px] font-medium text-white">Continue to {gateway}</button>
      <a href={cancelHref} className="mt-3 inline-block text-[13px] text-ink-500 hover:underline">Cancel</a>
    </div>
  );
}
