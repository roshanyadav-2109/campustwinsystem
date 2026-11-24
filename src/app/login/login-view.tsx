"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/i18n/provider";
import { SchoolEmblem } from "@/components/brand";
import type { Brand } from "@/lib/brand-server";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo";
import { safeNext } from "@/lib/safe-next";

function GoogleMark({ size = 20 }: { size?: number }) {
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
  google_not_registered: "This Google account isn't registered. Please ask the school office to add your email.",
  google_other_login: "Your record is already linked to a different login. Please ask the school office.",
  google_ambiguous: "This email is on more than one record. Please ask the school office.",
  google_failed: "Google sign-in didn't go through. Please try again.",
  google_off: "Google sign-in isn't set up yet.",
};

// One login screen, branded per institution from the subdomain (logo, name,
// place and primary colour). On the company console (`owner`) it is a plain
// owner sign-in: just Google, no school or demo logins.
export function LoginView({ brand, owner = false }: { brand: Brand; owner?: boolean }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function signIn(em: string, pw: string, key: string) {
    setBusy(key); setError(false);
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw });
    if (error) { setError(true); setBusy(null); return; }
    router.push(safeNext(params.get("next")));
    router.refresh();
  }
  function providerSignIn(key: string) {
    setBusy(key);
    const next = params.get("next");
    window.location.assign(`/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  const googleError = GOOGLE_ERRORS[params.get("error") ?? ""];
  const color = brand.primaryColor || "#0F6CBD";
  const logo = owner ? undefined : (brand.logo || undefined);
  const heading = owner ? "CampusTwin" : brand.name;
  const subline = owner ? null : brand.place;

  const rowBase = "flex w-full items-center gap-3 rounded-md border border-hair bg-surface px-4 py-2.5 text-[14px] text-ink-900 transition-colors hover:bg-panel disabled:opacity-50";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      {/* Left — branded panel in the institution's own colour (desktop). */}
      <div className="relative hidden flex-col justify-between p-12 text-white lg:flex" style={{ backgroundColor: color }}>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-white">
            {owner
              ? <span className="text-[18px] font-bold" style={{ color }}>CT</span>
              : <SchoolEmblem size={40} logo={logo} monogram={brand.monogram} name={brand.name} />}
          </span>
          <div className="leading-tight">
            <div className="text-[18px] font-semibold">{heading}</div>
            {subline && <div className="text-[13px] text-white/80">{subline}</div>}
          </div>
        </div>
        <div>
          <h2 className="font-display text-[36px] font-medium leading-[1.1]">{owner ? "Manage every institution." : "Welcome back."}</h2>
          <p className="mt-3 max-w-sm text-[15px] text-white/85">
            {owner ? "Sign in with your CampusTwin team account." : "Sign in to your school portal to continue."}
          </p>
        </div>
        <div className="text-[12px] text-white/75">Powered by CampusTwin</div>
      </div>

      {/* Right — sign-in. */}
      <div className="flex min-h-dvh flex-col justify-center bg-paper px-5 py-10 sm:px-10">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-hair bg-white">
            {owner
              ? <span className="text-[16px] font-bold" style={{ color }}>CT</span>
              : <SchoolEmblem size={36} logo={logo} monogram={brand.monogram} name={brand.name} />}
          </span>
          <div className="leading-tight">
            <div className="text-[16px] font-semibold text-ink-900">{owner ? "CampusTwin Console" : brand.name}</div>
            {subline && <div className="text-[12px] text-ink-500">{subline}</div>}
          </div>
        </div>

        <div className="mx-auto w-full max-w-sm">
          <h1 className="font-display text-[32px] font-medium tracking-[-0.02em] text-ink-900">{owner ? "Company sign-in" : "Welcome"}</h1>
          <p className="mt-1 text-[14px] text-ink-500">{owner ? "For the CampusTwin team only." : "Sign in to continue."}</p>

          {error && <p className="mt-4 rounded-md border border-down/30 bg-down-soft px-3 py-2 text-[13px] text-down">{t("auth.invalid")}</p>}
          {googleError && <p className="mt-4 rounded-md border border-down/30 bg-down-soft px-3 py-2 text-[13px] text-down">{googleError}</p>}

          <div className="mt-6 space-y-2">
            <button onClick={() => providerSignIn("google")} disabled={busy !== null} className={rowBase}>
              <span className="flex w-7 shrink-0 justify-center"><GoogleMark size={20} /></span>
              <span className="flex-1 text-left font-semibold">Continue with Google</span>
              {busy === "google" && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-hair border-t-ink-900" />}
            </button>
          </div>

          {!owner && (
            <>
              <div className="my-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                <span className="h-px flex-1 bg-hair" />
                {t("auth.demoTitle")}
                <span className="h-px flex-1 bg-hair" />
              </div>
              <div className="space-y-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button key={a.email} onClick={() => signIn(a.email, DEMO_PASSWORD, a.email)} disabled={busy !== null}
                    className={`${rowBase} group justify-between`}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel text-[12px] font-semibold text-ink-900">{t(`roles.${a.role}`).charAt(0)}</span>
                      <span className="truncate text-[14px] text-ink-900">{t(`roles.${a.role}`)}</span>
                    </span>
                    {busy === a.email
                      ? <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-hair border-t-ink-900" />
                      : <ArrowRightIcon size={16} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink-900" />}
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="mt-6 text-center text-[12px] text-ink-500">
            Powered by <span className="font-semibold text-ink-700">CampusTwin</span>
          </p>
        </div>
      </div>
    </div>
  );
}
