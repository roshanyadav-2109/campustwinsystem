import Link from "next/link";

// Global dark top bar — spans platform and every institution workspace, the way
// OCI / AWS keep a persistent product bar above the service navigation.
export function TopBar({ owner }: { owner: string | null }) {
  const initials = (owner ?? "?").slice(0, 2).toUpperCase();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 bg-[#13233c] px-3 sm:px-4">
      <Link href="/console" className="flex shrink-0 items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-[14px] font-bold text-white">C</span>
        <span className="text-[15px] font-semibold text-white max-sm:hidden">CampusTwin</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300 max-sm:hidden">Console</span>
      </Link>

      <form action="/console" method="get" className="relative mx-auto hidden w-full max-w-xl flex-1 md:block">
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input name="q" placeholder="Search institutions…" className="w-full rounded-md border border-white/10 bg-white/[0.07] py-1.5 pl-9 pr-3 text-[13px] text-white outline-none placeholder:text-slate-400 focus:border-white/25 focus:bg-white/10" />
      </form>

      <div className="ml-auto flex items-center gap-2.5">
        <span className="hidden items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-slate-300 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Production
        </span>
        <details className="group relative [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md p-1 hover:bg-white/10">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold text-white">{initials}</span>
            <svg className="text-slate-300" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
          </summary>
          <div className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-hair bg-white text-ink-800 shadow-[0_8px_24px_rgba(16,24,40,0.16)]">
            <div className="px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Signed in as</p>
              <p className="mt-0.5 truncate text-[13px] font-medium text-ink-900" title={owner ?? ""}>{owner}</p>
            </div>
            <div className="border-t border-hair">
              <Link href="/console/owners" className="block px-3.5 py-2 text-[13px] text-ink-700 hover:bg-panel">Team &amp; access</Link>
              <a href="/auth/signout" className="block border-t border-hair px-3.5 py-2 text-[13px] font-medium text-rose-600 hover:bg-rose-50">Sign out</a>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}

export function ConsoleFooter() {
  return (
    <footer className="border-t border-hair bg-white px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-400">
        <span>© {new Date().getFullYear()} CampusTwin · Platform console</span>
        <a href="https://campustwin.org" target="_blank" rel="noreferrer" className="hover:text-ink-700">campustwin.org</a>
      </div>
    </footer>
  );
}
