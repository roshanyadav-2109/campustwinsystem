"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { inputCls, labelCls, btnPrimary } from "@/components/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

// Only paths on this site, never another website or the sign-in page itself.
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/home";
  try {
    const u = new URL(next, "https://hr.invalid");
    if (u.origin !== "https://hr.invalid" || u.pathname.startsWith("/login")) return "/home";
    return u.pathname + u.search;
  } catch {
    return "/home";
  }
}

// Password sign-in runs in the browser (the same way CampusTwin signs in), and
// the session cookie is shared across every product on the base domain.
export function LoginForm({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!email || !password) return setError("Enter your email and password.");
    setBusy(true);
    setError(null);
    const host = window.location.hostname;
    const domain = host === BASE || host.endsWith("." + BASE) ? "." + BASE : undefined;
    const db = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, domain ? { cookieOptions: { domain } } : undefined);
    const { error: err } = await db.auth.signInWithPassword({ email, password });
    if (err) {
      setBusy(false);
      return setError("That email and password do not match an account.");
    }
    window.location.assign(safeNext(next));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className={labelCls}>Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
      </div>
      <div>
        <label htmlFor="password" className={labelCls}>Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} />
      </div>
      {error && <p role="alert" className="text-[13px] text-cx-bad">{error}</p>}
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy ? "Signing in" : "Sign in"}</button>
    </form>
  );
}
