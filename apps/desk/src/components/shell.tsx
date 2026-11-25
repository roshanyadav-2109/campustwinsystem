import Link from "next/link";
import type { Ctx } from "@/lib/context";
import { NavLink } from "@/components/nav-link";
import { Icon } from "@/components/icons";
import { switchOrg } from "@/app/(app)/actions";
import { Toaster, ActionForm } from "@/components/action-form";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="lg:pt-4">
      <p className="hidden px-3 pb-1 text-[12px] text-cx-muted lg:block">{label}</p>
      <div className="flex gap-1 lg:block lg:space-y-0.5">{children}</div>
    </div>
  );
}

// Black product bar, this product's own short sidebar, and the work area.
export function Shell({ ctx, children }: { ctx: Ctx; children: React.ReactNode }) {
  const nav = (
    <>
      <div className="flex gap-1 lg:block"><NavLink href="/home" icon="home" label="Home" exact /></div>
      {ctx.setUp && (
        <>
          <Group label="Requests">
            <NavLink href="/tickets" icon="announcements" label="All requests" />
            <NavLink href="/tickets/new" icon="new" label="Log a request" exact />
          </Group>
          <Group label="Help centre">
            <NavLink href="/articles" icon="library" label="Articles" />
          </Group>
          <Group label="Organisation">
            <NavLink href="/reports" icon="overview" label="Reports" />
            {ctx.isAdmin && <NavLink href="/settings" icon="settings" label="Settings" />}
          </Group>
        </>
      )}
    </>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 bg-cx-bar px-4 text-white">
        <Link href="/home" className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Eternity</span>
          <span className="text-[15px] text-white/70">Desk</span>
        </Link>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {ctx.orgs.length > 1 ? (
            <ActionForm action={switchOrg} className="flex items-center gap-2">
              <label htmlFor="org" className="sr-only">Organisation</label>
              <select id="org" name="org" defaultValue={ctx.org.id} className="max-w-[220px] truncate rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[13px] text-white">
                {ctx.orgs.map((o) => <option key={o.id} value={o.id} className="text-cx-text">{o.name}</option>)}
              </select>
              <button className="rounded-md border border-white/20 px-2 py-1 text-[12.5px] text-white/85 hover:bg-white/10">Open</button>
            </ActionForm>
          ) : (
            <span className="truncate text-[13px] text-white/80">{ctx.org.name}</span>
          )}
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-[13px] text-white/85 hover:bg-white/10">
              <span className="max-w-[180px] truncate">{ctx.email ?? "Account"}</span>
              <Icon name="chevron-down" size={14} />
            </summary>
            <div className="absolute right-0 mt-1 w-52 overflow-hidden rounded-md border border-cx-line bg-cx-card py-1 text-cx-text shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
              <p className="px-3 py-2 text-[12px] text-cx-muted">Your role: {ctx.role === "admin" ? "Desk admin" : "Agent"}</p>
              <form action="/auth/signout" method="post">
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-cx-raised">
                  <Icon name="sign-out" size={16} /> Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
        <div className="hidden border-r border-cx-line bg-cx-side lg:block">
          <aside className="sticky top-12 h-[calc(100dvh-3rem)] overflow-y-auto px-2 pb-6 pt-3">
            <p className="mb-1 truncate px-3 text-[13px] font-semibold text-cx-text" title={ctx.org.name}>{ctx.org.name}</p>
            <nav>{nav}</nav>
          </aside>
        </div>
        <nav className="sticky top-12 z-20 flex gap-1 overflow-x-auto border-b border-cx-line bg-cx-side px-2 py-1.5 lg:hidden">{nav}</nav>
        <main className="mx-auto w-full max-w-[1280px] min-w-0 px-4 pb-12 pt-5 sm:px-6">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
