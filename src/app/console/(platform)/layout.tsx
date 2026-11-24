import { Shell, NavLabel } from "@/components/console/shell";
import { ConsoleNavLink } from "@/components/console/nav-link";

function I({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
const grid = "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z";
const plus = "M12 5v14M5 12h14";
const team = "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const brand = (
    <div className="flex items-center gap-2 px-3.5 py-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#13233c] text-white"><I d={grid} /></span>
      <div><p className="text-[13px] font-semibold leading-tight text-ink-900">Platform</p><p className="text-[10.5px] text-ink-400">All institutions</p></div>
    </div>
  );
  return (
    <Shell
      brand={brand}
      nav={
        <>
          <NavLabel>Manage</NavLabel>
          <ConsoleNavLink href="/console" exact icon={<I d={grid} />} label="Overview" />
          <ConsoleNavLink href="/console/new" icon={<I d={plus} />} label="New institution" />
          <ConsoleNavLink href="/console/owners" icon={<I d={team} />} label="Team" />
        </>
      }
    >
      {children}
    </Shell>
  );
}
