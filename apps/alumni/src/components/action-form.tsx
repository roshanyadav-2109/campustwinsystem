"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

// `go`: a page to open once the action has succeeded.
export type ActionResult = { error?: string; ok?: string; go?: string } | null;
type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

const TOAST_EVENT = "eternity:toast";

// A form that runs a server action. Errors show next to the form (it is still
// there to fix). Success shows as a toast from the page frame, because the form
// itself often disappears once the page refreshes (an approved request leaves
// the queue, a check-in button becomes check-out).
export function ActionForm({ action, children, className, reset }: { action: Action; children: React.ReactNode; className?: string; reset?: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, run] = useActionState(async (prev: ActionResult, form: FormData) => {
    const result = await action(prev, form);
    if (result?.ok) {
      window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: result.ok }));
      if (reset) ref.current?.reset();
    }
    if (result?.go && result.go.startsWith("/") && !result.go.startsWith("//")) window.location.assign(result.go);
    return result;
  }, null);
  return (
    <form ref={ref} action={run} className={className}>
      {children}
      {state?.error && <p role="alert" className="mt-2 text-[13px] text-cx-bad">{state.error}</p>}
    </form>
  );
}

export function Submit({ children, className, pending: pendingLabel }: { children: React.ReactNode; className: string; pending?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (pendingLabel ?? "Saving") : children}
    </button>
  );
}

// Lives in the page frame, so it outlasts the form that triggered it.
export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setMsg((m) => ({ text, n: (m?.n ?? 0) + 1 }));
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 3500);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => { window.removeEventListener(TOAST_EVENT, on); clearTimeout(timer); };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      {msg && (
        <p key={msg.n} role="status" className="rounded-md bg-cx-text px-4 py-2 text-[13.5px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
          {msg.text}
        </p>
      )}
    </div>
  );
}
