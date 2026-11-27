import Link from "@/components/ui/hover-link";
import { Icon } from "./icons";
import { SearchBox } from "./search-box";

// Global product bar: black, 48px, persistent above every console page.
export function TopBar({ owner }: { owner: string | null }) {
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-4 bg-cx-bar px-4">
      <Link href="/console" className="flex shrink-0 items-center gap-2.5" aria-label="CampusTwin console home">
        {/* eslint-disable-next-line @next/next/no-img-element -- brand wordmark, white + brand red for the dark bar */}
        <img src="/brand/campustwin-wordmark-on-dark.png" alt="CampusTwin" className="h-[17px] w-auto" />
        <span className="border-l border-white/20 pl-2.5 text-[13px] font-medium text-white/70 max-sm:hidden">Console</span>
      </Link>

      <div className="hidden flex-1 md:flex md:justify-center">
        <SearchBox />
      </div>

      <details className="relative ml-auto [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-[13px] text-white/80 transition-colors hover:bg-white/10 hover:text-white">
          <span className="max-w-[220px] truncate max-sm:hidden">{owner}</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[11px] font-medium text-white sm:hidden">{(owner ?? "?").slice(0, 1).toUpperCase()}</span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-cx-line bg-cx-card shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          <div className="px-3 py-2.5">
            <p className="text-[12px] text-cx-muted">Signed in as</p>
            <p className="truncate text-[13px] font-medium text-cx-text" title={owner ?? ""}>{owner}</p>
          </div>
          <div className="border-t border-cx-line p-1">
            <Link href="/console/owners" className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-cx-text-2 transition-colors hover:bg-cx-raised hover:text-cx-text">
              <Icon name="team" size={16} className="text-cx-muted" />Team and access
            </Link>
            <a href="/auth/signout" className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-cx-text-2 transition-colors hover:bg-cx-raised hover:text-cx-text">
              <Icon name="sign-out" size={16} className="text-cx-muted" />Sign out
            </a>
          </div>
        </div>
      </details>
    </header>
  );
}

export function ConsoleFooter() {
  return (
    <footer className="border-t border-cx-line bg-cx-card px-6">
      <div className="mx-auto flex h-10 max-w-[1440px] items-center justify-between text-[12px] text-cx-muted">
        <span>© {new Date().getFullYear()} CampusTwin</span>
        <a href="https://campustwin.org" target="_blank" rel="noreferrer" className="transition-colors hover:text-cx-text">campustwin.org</a>
      </div>
    </footer>
  );
}
