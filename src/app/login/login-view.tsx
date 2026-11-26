"use client";
/* eslint-disable @next/next/no-img-element -- static brand wordmark from /public */
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/provider";
import { SchoolEmblem } from "@/components/brand";
import type { Brand } from "@/lib/brand-server";
import { DEMO_ACCOUNTS } from "@/lib/demo";
import { demoSignIn } from "@/app/login/actions";
import { safeNext } from "@/lib/safe-next";

function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_not_registered: "This Google account isn't registered here. Ask your school office to add your email.",
  google_other_login: "Your record is linked to a different login. Ask your school office.",
  google_ambiguous: "This email is on more than one record. Ask your school office.",
  google_failed: "Google sign-in didn't go through. Try again.",
  google_off: "Google sign-in isn't set up yet.",
};

function Spinner() {
  return <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-cx-line-strong border-t-cx-text" />;
}

// One sign-in screen. On a school subdomain it carries that school's logo, name
// and colour; on the console host it carries the CampusTwin mark. Same layout.
export function LoginView({ brand, owner = false, demo = false }: { brand: Brand; owner?: boolean; demo?: boolean }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function openDemo(em: string) {
    setBusy(em); setError(false);
    const r = await demoSignIn(em);
    if (!r.ok) { setError(true); setBusy(null); return; }
    router.push(safeNext(params.get("next")));
    router.refresh();
  }
  function google() {
    setBusy("google");
    const next = params.get("next");
    window.location.assign(`/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  const googleError = GOOGLE_ERRORS[params.get("error") ?? ""];
  const message = error ? t("auth.invalid") : googleError;

  return (
    <div className="flex min-h-dvh flex-col bg-cx-bg" style={owner ? undefined : { borderTop: `4px solid ${brand.primaryColor || "#18181b"}` }}>
      <header className="px-6 py-6 sm:px-10">
        {owner ? (
          <span className="inline-flex items-center gap-2.5">
            <img src="/brand/campustwin-wordmark.webp" alt="CampusTwin" className="h-6 w-auto" />
            <span className="border-l border-cx-line-strong pl-2.5 text-[14px] font-medium text-cx-text-2">Console</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-cx-line bg-white">
              <SchoolEmblem size={34} logo={brand.logo || undefined} monogram={brand.monogram} name={brand.name} />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold text-cx-text">{brand.name}</span>
              {brand.place && <span className="block text-[12.5px] text-cx-muted">{brand.place}</span>}
            </span>
          </span>
        )}
      </header>

      <main className="flex flex-1 justify-center px-6 pb-16 pt-[10vh]">
        <div className="w-full max-w-[400px]">
          <h1 className="text-[32px] font-semibold leading-10 text-cx-text">Sign in</h1>

          {message && (
            <p role="alert" className="mt-4 rounded-md border border-cx-bad/25 bg-cx-bad/[0.06] px-3 py-2 text-[13px] text-cx-bad">{message}</p>
          )}

          <button
            onClick={google}
            disabled={busy !== null}
            className="relative mt-6 flex h-10 w-full items-center justify-center rounded-md border border-cx-line-strong bg-white text-[14px] font-medium text-cx-text transition-colors hover:bg-cx-raised disabled:opacity-60"
          >
            <span className="absolute left-3"><GoogleMark /></span>
            Sign in with Google
            {busy === "google" && <span className="absolute right-3"><Spinner /></span>}
          </button>

          {!owner && demo && DEMO_ACCOUNTS.length > 0 && (
            <>
              <div className="my-6 flex items-center gap-4 text-[13px] text-cx-muted">
                <span className="h-px flex-1 bg-cx-line" />
                or try a demo role
                <span className="h-px flex-1 bg-cx-line" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    onClick={() => openDemo(a.email)}
                    disabled={busy !== null}
                    className="flex h-10 items-center justify-between gap-2 rounded-md border border-cx-line-strong bg-white px-3 text-[13.5px] text-cx-text transition-colors hover:bg-cx-raised disabled:opacity-60"
                  >
                    <span className="truncate">{t(`roles.${a.role}`)}</span>
                    {busy === a.email && <Spinner />}
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="mt-6 text-[13px] leading-5 text-cx-muted">
            {owner
              ? "Use the Google account your access was granted to."
              : "Use the Google account your school has on record for you."}
          </p>
        </div>
      </main>

      {!owner && (
        <footer className="px-6 pb-6 text-[12px] text-cx-muted sm:px-10">Powered by CampusTwin</footer>
      )}
    </div>
  );
}
