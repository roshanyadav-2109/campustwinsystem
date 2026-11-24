import { redirect } from "next/navigation";
import { getOwnerEmail } from "@/lib/owner";
import { ConsoleNavLink } from "@/components/console/nav-link";

function IconGrid() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconTeam() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const owner = await getOwnerEmail();
  if (!owner) redirect("/login?next=/console");

  const nav = (
    <>
      <p className="px-3 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">Platform</p>
      <ConsoleNavLink href="/console" exact icon={<IconGrid />} label="Overview" />
      <ConsoleNavLink href="/console/new" icon={<IconPlus />} label="New institution" />
      <ConsoleNavLink href="/console/owners" icon={<IconTeam />} label="Team" />
    </>
  );

  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[252px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-hair bg-white lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-hair px-5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand wordmark */}
          <img src="/brand/campustwin-wordmark.webp" alt="CampusTwin" className="h-6 w-auto" />
          <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Console</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">{nav}</nav>
        <div className="border-t border-hair p-3">
          <div className="rounded-lg bg-panel px-3 py-2.5">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-400">Signed in</p>
            <p className="mt-0.5 truncate text-[12.5px] font-medium text-ink-800" title={owner}>{owner}</p>
            <a href="/auth/signout" className="mt-2 inline-block text-[12px] font-medium text-[#0F6CBD] hover:underline">Sign out</a>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hair bg-white px-4 lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand wordmark */}
        <img src="/brand/campustwin-wordmark.webp" alt="CampusTwin" className="h-6 w-auto" />
        <nav className="ml-2 flex items-center gap-1 overflow-x-auto text-[13px]">{nav}</nav>
        <a href="/auth/signout" className="ml-auto shrink-0 text-[12px] font-medium text-[#0F6CBD]">Sign out</a>
      </header>

      <div className="flex min-w-0 flex-col">
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
