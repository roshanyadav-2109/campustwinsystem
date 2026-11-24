import { getOwnerEmail } from "@/lib/owner";
import { Shell, NavLabel, Wordmark } from "@/components/console/shell";
import { ConsoleNavLink } from "@/components/console/nav-link";

function I({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
const grid = "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z";
const plus = "M12 5v14M5 12h14";
const team = "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const owner = await getOwnerEmail();
  return (
    <Shell
      brand={<Wordmark />}
      nav={
        <>
          <NavLabel>Platform</NavLabel>
          <ConsoleNavLink href="/console" exact icon={<I d={grid} />} label="Overview" />
          <ConsoleNavLink href="/console/new" icon={<I d={plus} />} label="New institution" />
          <ConsoleNavLink href="/console/owners" icon={<I d={team} />} label="Team" />
        </>
      }
      footer={
        <div className="rounded-md bg-panel px-2.5 py-2">
          <p className="truncate text-[11.5px] font-medium text-ink-700" title={owner ?? ""}>{owner}</p>
          <a href="/auth/signout" className="mt-1 inline-block text-[11.5px] font-medium text-[#0F6CBD] hover:underline">Sign out</a>
        </div>
      }
    >
      {children}
    </Shell>
  );
}
