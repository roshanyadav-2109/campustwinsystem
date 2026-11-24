// The console frame below the black bar: a fixed service rail and a fluid work
// area. Shared by the platform and every institution so both levels read as one tool.
export function Shell({ brand, nav, crumbs, children }: { brand: React.ReactNode; nav: React.ReactNode; crumbs?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-3rem)] lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-12 z-20 hidden h-[calc(100dvh-3rem)] flex-col border-r border-cx-line bg-cx-card lg:flex">
        <div className="border-b border-cx-line">{brand}</div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4 pt-1">{nav}</nav>
      </aside>

      <header className="sticky top-12 z-30 border-b border-cx-line bg-cx-card lg:hidden">
        {brand}
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">{nav}</nav>
      </header>

      <div className="min-w-0 bg-cx-bg">
        <main className="cx-main mx-auto w-full max-w-[1440px] px-6 pb-8 pt-3">
          {crumbs}
          {children}
        </main>
      </div>
    </div>
  );
}

export function NavLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pb-1 pt-4 text-[12px] font-medium text-cx-muted max-lg:hidden">{children}</p>;
}
