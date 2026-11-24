import { RailLink } from "./nav-link";
import { Icon } from "./icons";

// The console frame below the black bar: icon rail (toolkits) + panel (the
// current toolkit's pages) + a fluid work area of cards.
function Rail() {
  return (
    <>
      <RailLink href="/console" exact icon={<Icon name="overview" size={20} />} label="Home" />
      <RailLink href="/console/institutions" icon={<Icon name="institution" size={20} />} label="Institutions" also={["/console/school", "/console/university", "/console/new"]} />
      <RailLink href="/console/owners" icon={<Icon name="team" size={20} />} label="Team" />
    </>
  );
}

export function Shell({ panel, crumbs, children }: { panel: React.ReactNode; crumbs?: React.ReactNode; children: React.ReactNode; brand?: React.ReactNode; nav?: React.ReactNode }) {
  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-3rem)] lg:grid-cols-[84px_248px_minmax(0,1fr)]">
      <aside className="sticky top-12 z-20 hidden h-[calc(100dvh-3rem)] flex-col items-center gap-1 border-r border-cx-line bg-cx-side py-3 lg:flex">
        <Rail />
      </aside>
      <aside className="sticky top-12 z-20 hidden h-[calc(100dvh-3rem)] overflow-y-auto border-r border-cx-line bg-cx-side px-2 pb-6 pt-3 lg:block">
        {panel}
      </aside>

      <nav className="sticky top-12 z-30 flex gap-1 overflow-x-auto border-b border-cx-line bg-cx-side px-2 py-1.5 lg:hidden">
        <Rail />
      </nav>

      <div className="min-w-0 bg-cx-bg">
        <main className="cx-main mx-auto w-full max-w-[1440px] px-6 pb-10 pt-3">
          {crumbs}
          {children}
        </main>
      </div>
    </div>
  );
}

export function PanelTitle({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <div className="mb-2 px-3 pt-1">
      <p className="text-[15px] font-semibold leading-5 text-cx-text">{title}</p>
      {sub && <div className="mt-0.5 text-[12px] text-cx-muted">{sub}</div>}
    </div>
  );
}

export function NavLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 pt-5 text-[12.5px] text-cx-muted">{children}</p>;
}
