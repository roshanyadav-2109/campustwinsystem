"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const isActive = (p: string, href: string, exact?: boolean, also: string[] = []) =>
  (exact ? p === href : p === href || p.startsWith(href + "/")) || also.some((a) => p === a || p.startsWith(a + "/"));

// Icon rail tile: icon over a short label. Selected = a plain grey fill.
export function RailLink({ href, label, icon, exact, also }: { href: string; label: string; icon: React.ReactNode; exact?: boolean; also?: string[] }) {
  const active = isActive(usePathname(), href, exact, also);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[60px] w-[68px] flex-col items-center justify-center gap-1 rounded-lg text-[11.5px] leading-tight transition-colors",
        active ? "bg-cx-sel font-medium text-cx-text" : "text-cx-text-2 hover:bg-cx-hover hover:text-cx-text",
      )}
    >
      {icon}
      <span className="text-center">{label}</span>
    </Link>
  );
}

// Panel row: text only, like the second column in Semrush and Google Admin.
export function PanelLink({ href, label, exact, meta, dot }: { href: string; label: string; exact?: boolean; meta?: string; dot?: "ok" | "warn" }) {
  const active = isActive(usePathname(), href, exact);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-8 items-center gap-2 rounded-md px-3 py-1.5 text-[14px] leading-5 transition-colors",
        active ? "bg-cx-sel font-medium text-cx-text" : "text-cx-text-2 hover:bg-cx-hover hover:text-cx-text",
      )}
    >
      {dot && <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot === "ok" ? "bg-cx-ok" : "bg-cx-warn")} />}
      <span className="min-w-0 flex-1">{label}</span>
      {meta && <span className="shrink-0 text-[12px] tabular-nums text-cx-muted">{meta}</span>}
    </Link>
  );
}

// Backwards-compatible alias for any caller still using the old single-column link.
export function ConsoleNavLink({ href, label, exact }: { href: string; label: string; icon?: React.ReactNode; exact?: boolean }) {
  return <PanelLink href={href} label={label} exact={exact} />;
}
