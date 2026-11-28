"use client";
import { useEffect, useRef, useState } from "react";

type Options = Record<string, unknown> & { callback_url: string };
type RzpCtor = new (o: Options) => { open(): void };

// Loads Razorpay's checkout script and opens it; the result is posted to our return address by Razorpay.
export function RazorpayCheckout({ options, amountText, school, student, cancelHref, test }: { options: Options; amountText: string; school: string; student: string; cancelHref: string; test: boolean }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);
  const open = () => {
    const Rzp = (window as unknown as { Razorpay?: RzpCtor }).Razorpay;
    if (!Rzp) { setError("The payment window could not load. Check your connection and try again."); return; }
    new Rzp({ ...options, modal: { ondismiss: () => setError("The payment window was closed. No money was taken.") } }).open();
  };
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => { setReady(true); if (!opened.current) { opened.current = true; open(); } };
    s.onerror = () => setError("The payment window could not load. Check your connection and try again.");
    document.body.appendChild(s);
    return () => { s.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="rounded-md border border-hair bg-white p-6 text-center">
      <p className="text-[13px] text-ink-500">{school}</p>
      <h1 className="mt-1 text-[22px] font-semibold text-ink-900">{amountText}</h1>
      <p className="mt-1 text-[13px] text-ink-700">For {student}{test ? " (test payment: no real money)" : ""}</p>
      {error && <p role="alert" className="mt-3 text-[13px] text-down">{error}</p>}
      <button type="button" disabled={!ready} onClick={open} className="mt-5 h-10 w-full rounded-md bg-ink-900 text-[14px] font-medium text-white disabled:opacity-50">{ready ? "Pay now" : "Opening the payment window…"}</button>
      <a href={cancelHref} className="mt-3 inline-block text-[13px] text-ink-500 hover:underline">Cancel</a>
      <p className="mt-4 text-[11px] text-ink-500">Payments are processed securely by Razorpay. Card and bank details are never seen by the institution.</p>
    </div>
  );
}
