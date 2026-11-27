"use client";
import { useEffect, useState } from "react";
import Link from "@/components/ui/hover-link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

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
        "flex h-[60px] w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg text-[11.5px] leading-tight transition-colors",
        active ? "bg-cx-sel font-medium text-cx-text" : "text-cx-text-2 hover:bg-cx-hover hover:text-cx-text",
      )}
    >
      {icon}
      <span className="text-center">{label}</span>
    </Link>
  );
}

// A row in the panel. Top level rows carry an icon; sub rows sit under a parent.
export function PanelLink({ href, label, exact, meta, dot, icon, sub }: {
  href: string; label: string; exact?: boolean; meta?: string; dot?: "ok" | "warn"; icon?: React.ComponentProps<typeof Icon>["name"]; sub?: boolean;
}) {
  const active = isActive(usePathname(), href, exact);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-8 items-center gap-2.5 rounded-md py-1.5 leading-5 transition-colors",
        sub ? "pl-3 pr-2 text-[13.5px]" : "px-2 text-[14px]",
        active ? "bg-cx-sel font-medium text-cx-text" : "text-cx-text-2 hover:bg-cx-hover hover:text-cx-text",
      )}
    >
      {icon && <Icon name={icon} size={18} className={active ? "text-cx-text" : "text-cx-muted"} />}
      {dot && <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot === "ok" ? "bg-cx-ok" : "bg-cx-warn")} />}
      <span className="min-w-0 flex-1">{label}</span>
      {meta && <span className="shrink-0 text-[12px] tabular-nums text-cx-muted">{meta}</span>}
    </Link>
  );
}

// Parent tab with its sub tabs. Opens itself when one of its pages is current;
// otherwise remembers whether the viewer left it open or closed.
export function NavGroup({ id, label, icon, hrefs, children }: {
  id: string; label: string; icon: React.ComponentProps<typeof Icon>["name"]; hrefs: string[]; children: React.ReactNode;
}) {
  const p = usePathname();
  const holdsCurrent = hrefs.some((h) => p === h || p.startsWith(h + "/"));
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`cx-nav:${id}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the viewer's saved preference after mount
      if (saved !== null) setOpen(saved === "1");
    } catch { /* storage unavailable: keep default */ }
  }, [id]);
  const shown = open || holdsCurrent;
  const toggle = () => {
    const next = !shown;
    setOpen(next);
    try { localStorage.setItem(`cx-nav:${id}`, next ? "1" : "0"); } catch { /* ignore */ }
  };

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={shown}
        className={cn(
          "flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[14px] leading-5 transition-colors hover:bg-cx-hover",
          holdsCurrent ? "font-medium text-cx-text" : "text-cx-text-2 hover:text-cx-text",
        )}
      >
        <Icon name={icon} size={18} className={holdsCurrent ? "text-cx-text" : "text-cx-muted"} />
        <span className="flex-1">{label}</span>
        <Icon name="chevron-right" size={14} className={cn("text-cx-muted transition-transform duration-150", shown && "rotate-90")} />
      </button>
      {shown && <div className="mt-0.5 space-y-0.5 pl-6">{children}</div>}
    </div>
  );
}

// Backwards-compatible alias.
export function ConsoleNavLink({ href, label, exact }: { href: string; label: string; icon?: React.ReactNode; exact?: boolean }) {
  return <PanelLink href={href} label={label} exact={exact} />;
}
