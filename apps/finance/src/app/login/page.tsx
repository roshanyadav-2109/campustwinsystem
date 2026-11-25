import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  google_off: "Google sign-in is not available here yet. Use your email and password.",
  google_failed: "Google sign-in did not complete. Please try again.",
  google_not_registered: "This Google account is not linked to any organisation yet. Ask your accounts team to add your email.",
};

// Google sign-in goes through the shared sign-in service, which signs people in
// to the live platform; it is shown only when this app runs on the live platform.
const GOOGLE = process.env.GOOGLE_SIGNIN === "1";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next ?? "/home";
  const problem = sp.error ? ERRORS[sp.error] ?? ERRORS.google_failed : null;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center bg-cx-bar px-4 text-white">
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Eternity</span>
        <span className="ml-2 text-[15px] text-white/70">Finance</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[12vh]">
        <div className="w-full max-w-[380px]">
          <h1 className="text-[24px] font-semibold leading-8 text-cx-text">Sign in</h1>
          <p className="mb-6 mt-1 text-[14px] text-cx-muted">Accounts, GST invoices, receipts and reports for your organisation.</p>
          {problem && <p role="alert" className="mb-4 rounded-md border border-cx-line bg-cx-card px-3 py-2 text-[13px] text-cx-bad">{problem}</p>}
          <div className="space-y-4 rounded-[10px] border border-cx-line bg-cx-card p-5">
            {GOOGLE && (
              <>
                <a href={`/auth/google/start?next=${encodeURIComponent(next)}`} className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-cx-line-strong bg-cx-card text-[13.5px] font-medium text-cx-text hover:bg-cx-raised">
                  <GoogleMark /> Continue with Google
                </a>
                <div className="flex items-center gap-3 text-[12px] text-cx-faint"><span className="h-px flex-1 bg-cx-line" />or<span className="h-px flex-1 bg-cx-line" /></div>
              </>
            )}
            <LoginForm next={next} />
          </div>
          <p className="mt-4 text-[12.5px] leading-5 text-cx-muted">Signed in to another Eternity product on this browser? You are signed in here too.</p>
        </div>
      </main>
    </div>
  );
}
