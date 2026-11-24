import Link from "next/link";

// The console frame: a fixed left rail + a scrolling work area. Shared by the
// platform rail and every institution workspace so both levels feel like one tool.
export function Shell({ brand, nav, footer, children }: { brand: React.ReactNode; nav: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-3.5rem)] lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-14 z-20 hidden h-[calc(100dvh-3.5rem)] flex-col border-r border-hair bg-white lg:flex">
        <div className="border-b border-hair">{brand}</div>
        <nav className="flex-1 space-y-px overflow-y-auto px-2 py-2.5">{nav}</nav>
        {footer && <div className="border-t border-hair p-2">{footer}</div>}
      </aside>

      <header className="sticky top-14 z-30 border-b border-hair bg-white lg:hidden">
        <div className="border-b border-hair">{brand}</div>
        <nav className="flex gap-1 overflow-x-auto px-2 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none]">{nav}</nav>
      </header>

      <div className="flex min-w-0 flex-col bg-paper">
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-7">{children}</main>
      </div>
    </div>
  );
}

export function NavLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-400 max-lg:hidden">{children}</p>;
}

export function Wordmark() {
  return (
    <Link href="/console" className="flex h-13 items-center gap-2 px-4 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand wordmark */}
      <img src="/brand/campustwin-wordmark.webp" alt="CampusTwin" className="h-6 w-auto" />
      <span className="rounded bg-panel px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">Console</span>
    </Link>
  );
}
