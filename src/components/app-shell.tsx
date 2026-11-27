"use client";
import { useEffect, useState } from "react";
import { setPdfSchool } from "@/lib/pdf";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchBox } from "@/components/search-box";
import { NavProgress } from "@/components/nav-progress";
import { cn } from "@/lib/utils";
import { navFor, type NavRole } from "@/lib/nav";
import { NAV_GROUPS } from "@/core/routes";
import type { Edition } from "@/core/edition";
import { useT } from "@/i18n/provider";
import { SchoolEmblem } from "@/components/brand";
import { SCHOOL } from "@/lib/school";
import { SignOutModal } from "@/components/dashboards/profile-menu";
import { LocaleSwitcher } from "@/components/locale-switcher";

// The standard three-line menu button, drawn plainly rather than from the illustrated set.
function HamburgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

// The notifications bell, drawn plainly like the menu button.
function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function AppShell({
  name,
  role,
  types = [],
  roleLabel,
  modules,
  edition,
  institutions = [],
  brand,
  university,
  unread = 0,
  children,
}: {
  name: string;
  role: NavRole;
  types?: string[];
  roleLabel: string;
  modules?: Record<string, boolean>;
  edition: Edition;
  /** Every institution this person belongs to (more than one = a switcher). */
  institutions?: { name: string; slug: string; role: string; current: boolean }[];
  brand?: { name: string; place: string | null; logo: string | null; monogram: string | null };
  university?: { name: string; activeCampusName: string | null } | null;
  /** Unread notifications, for the bell. */
  unread?: number;
  children: React.ReactNode;
}) {
  const bName = brand?.name || SCHOOL.name;
  const bPlace = brand?.place ?? SCHOOL.place;
  // Every PDF download uses this institution's name on its letterhead.
  useEffect(() => { setPdfSchool(bPlace ? `${bName}, ${bPlace}` : bName); }, [bName, bPlace]);
  const bLogo = brand?.logo ?? undefined;
  const bMono = brand?.monogram ?? undefined;
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const items = navFor(role, modules, edition, types);

  // Desktop side menu can be hidden from the top bar for more room.
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = () => setCollapsed((c) => !c);

  // Everyone gets search; staff search people and classes, families search
  // pages and notices (and their own children).
  const isStaffRole = role === "principal" || role === "office" || role === "class_teacher" || role === "subject_teacher";

  const isDashboard = pathname === "/dashboard";

  // Longest matching prefix wins, so /transport/riders lights up its own entry
  // and not the /transport one above it. The "/" boundary keeps a href from
  // matching a sibling that merely starts with the same letters.
  const matches = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(`${href}/`);
  const activeHref = items
    .map((i) => i.href)
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  const universityActive = pathname === "/dashboard/university" || pathname.startsWith("/dashboard/university/");
  const navList = (
    <nav className="flex flex-col gap-0.5 p-3">
      {university && (
        <Link
          href="/dashboard/university"
          onClick={() => setOpen(false)}
          aria-current={universityActive ? "page" : undefined}
          className={cn(
            "group relative mb-1 flex flex-col gap-0.5 rounded-sm border border-hair px-3 py-2 text-[13px] transition-colors",
            universityActive ? "bg-panel" : "hover:bg-panel",
          )}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">University</span>
          <span className="font-semibold text-ink-900">{university.name}</span>
          {university.activeCampusName && (
            <span className="text-[12px] text-ink-500">In: {university.activeCampusName} · switch</span>
          )}
        </Link>
      )}
      {NAV_GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g);
        if (!list.length) return null;
        return (
          <div key={g} className={cn(g === "settings" && "mt-2 border-t border-hair pt-2", g !== "home" && g !== "settings" && "mt-3")}>
            {g !== "home" && g !== "settings" && (
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{t(`navGroup.${g}`)}</div>
            )}
            {list.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href + item.labelKey}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-sm px-3 py-2 text-[14px] transition-colors",
                    active ? "font-semibold text-ink-900" : "font-normal text-ink-500 hover:text-ink-900",
                  )}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[#0F6CBD]" />
                  ) : (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[rgb(156,163,175)] opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                  <Icon size={20} active={active} />
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  const brandHeader = (
    <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-hair px-4">
      <SchoolEmblem size={32} logo={bLogo} monogram={bMono} name={bName} />
      <div className="leading-tight">
        <div className="text-[13px] font-bold text-ink-900">{bName}</div>
        {bPlace && <div className="text-[11px] text-muted">{bPlace}</div>}
      </div>
    </div>
  );

  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  // Everyone's name, role and sign-out sit at the foot of the side menu, on
  // every page — the same place in the desktop rail and the phone drawer —
  // with the CampusTwin credit just above.
  const personCard = (
    <div className="border-t border-hair p-3">
      <div className="mb-2 block text-center text-[11px] text-ink-500">
        Powered by <span className="font-semibold text-ink-700">CampusTwin</span>
      </div>
      {institutions.length > 1 && (
        <details className="mb-2 rounded-md border border-hair">
          <summary className="cursor-pointer list-none px-3 py-2 text-[13px] text-ink-700 hover:bg-panel">Switch institution ({institutions.length})</summary>
          <ul className="border-t border-hair py-1">
            {institutions.map((i) => (
              <li key={`${i.slug}-${i.role}`}>
                <a href={`https://${i.slug}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}/dashboard`} aria-current={i.current ? "true" : undefined}
                  className={cn("block px-3 py-1.5 text-[13px] hover:bg-panel", i.current ? "font-semibold text-ink-900" : "text-[#0F6CBD]")}>
                  {i.name}<span className="block text-[11px] font-normal text-ink-500">{i.role === "staff" ? "Staff" : i.role === "guardian" ? "Parent" : "Student"}{i.current ? " · here now" : ""}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <button
        onClick={() => { setOpen(false); setMenuOpen(true); }}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-panel"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hair bg-panel text-[13px] font-semibold text-ink-900">{initials}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block break-words text-[14px] font-semibold text-ink-900">{name}</span>
          <span className="block truncate text-[12px] text-ink-500">{roleLabel}</span>
        </span>
        <span className="flex flex-col items-center gap-[3px] text-ink-700" aria-hidden>
          <span className="h-1 w-1 rounded-full bg-current" /><span className="h-1 w-1 rounded-full bg-current" /><span className="h-1 w-1 rounded-full bg-current" />
        </span>
      </button>
    </div>
  );

  return (
    <NavProgress>
    <div className={cn("min-h-dvh bg-white lg:grid", collapsed ? "lg:grid-cols-[1fr]" : "lg:grid-cols-[264px_1fr]")}>
      {/* Desktop side menu — attached to the left edge, full height */}
      <aside className={cn("sticky top-0 hidden h-dvh flex-col overflow-hidden border-r border-hair bg-surface", !collapsed && "lg:flex")}>
        {brandHeader}
        <div className="flex-1 overflow-y-auto">
          {navList}
        </div>
        {personCard}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/30" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex h-16 items-center justify-between border-b border-hair px-4">
              <div className="flex items-center gap-2.5">
                <SchoolEmblem size={32} logo={bLogo} monogram={bMono} name={bName} />
                <span className="text-[13px] font-bold text-ink-900">{bName}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {navList}
            </div>
            {personCard}
          </aside>
        </div>
      )}

      <SignOutModal
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        promptLabel={t("dashboard.logoutPrompt")}
        confirmLabel={t("dashboard.confirmSignOut")}
        cancelLabel={t("dashboard.cancel")}
      />

      <div className="flex min-w-0 flex-col">
        {/* Top bar: menu button, student search for staff, a parent's language picker. */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-hair bg-white px-3 sm:px-4">
          <button aria-label="Menu" onClick={() => setOpen(true)} className="rounded-sm p-1.5 text-ink-700 hover:bg-panel lg:hidden">
            <HamburgerIcon />
          </button>
          <button aria-label={collapsed ? "Show menu" : "Hide menu"} title={collapsed ? "Show menu" : "Hide menu"} onClick={toggleCollapsed}
            className="hidden rounded-sm p-1.5 text-ink-700 hover:bg-panel lg:block">
            <HamburgerIcon />
          </button>
          <div className={cn(!collapsed && "lg:hidden")}>
            <SchoolEmblem size={28} logo={bLogo} monogram={bMono} name={bName} />
          </div>
          {role !== "transport" && (
            <SearchBox placeholder={t(isStaffRole ? "x.searchEverything" : "x.searchFamily")} />
          )}
          <div className="ml-auto flex items-center gap-2">
            {role === "guardian" && isDashboard && <LocaleSwitcher />}
            <Link href="/dashboard/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications"
              className="relative rounded-sm p-1.5 text-ink-700 hover:bg-panel">
              <BellIcon />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-down px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
              )}
            </Link>
          </div>
        </header>

        {/* Each section is its own block on the page — no shared wrapper. */}
        <main className="w-full flex-1 p-3 lg:px-5 lg:py-4">
          {children}
        </main>
      </div>
    </div>
    </NavProgress>
  );
}
