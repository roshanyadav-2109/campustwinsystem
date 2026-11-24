import { redirect } from "next/navigation";
import { getOwnerEmail } from "@/lib/owner";
import { createClient } from "@/lib/supabase/server";
import { TopBar, ConsoleFooter } from "@/components/console/topbar";

// Owner gate + the global chrome (dark top bar, footer). Each section supplies
// its own Shell underneath, so the left navigation switches to match context.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const owner = await getOwnerEmail();
  if (!owner) {
    // Signed out: go and sign in. Signed in with an account that isn't on the
    // owner list (sessions are shared across *.campustwin.org): explain, don't
    // redirect, or /login would bounce a signed-in visitor straight back here.
    const { data } = await (await createClient()).auth.getClaims();
    if (!data?.claims?.sub) redirect("/login?next=/console");
    return <NoAccess email={(data.claims.email as string | undefined) ?? null} />;
  }
  return (
    <div className="flex min-h-dvh flex-col bg-cx-bg text-cx-text">
      <TopBar owner={owner} />
      <div className="flex-1">{children}</div>
      <ConsoleFooter />
    </div>
  );
}

function NoAccess({ email }: { email: string | null }) {
  return (
    <div className="flex min-h-dvh flex-col bg-cx-bg">
      <header className="px-6 py-6 sm:px-10">
        <span className="inline-flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand wordmark */}
          <img src="/brand/campustwin-wordmark.webp" alt="CampusTwin" className="h-6 w-auto" />
          <span className="border-l border-cx-line-strong pl-2.5 text-[14px] font-medium text-cx-text-2">Console</span>
        </span>
      </header>
      <main className="flex flex-1 justify-center px-6 pb-16 pt-[10vh]">
        <div className="w-full max-w-[400px]">
          <h1 className="text-[32px] font-semibold leading-10 text-cx-text">No console access</h1>
          <p className="mt-3 text-[14px] leading-6 text-cx-text-2">
            You&apos;re signed in as <span className="font-medium text-cx-text">{email ?? "an account"}</span>, which can&apos;t open the console.
            Sign out, then sign in with the Google account your access was granted to.
          </p>
          <a href="/auth/signout" className="mt-6 flex h-10 w-full items-center justify-center rounded-md bg-cx-text text-[14px] font-medium text-white transition-colors hover:bg-black">
            Sign out and switch account
          </a>
        </div>
      </main>
    </div>
  );
}
