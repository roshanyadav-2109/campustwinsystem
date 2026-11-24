"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ConsoleNavLink({ href, label, icon, exact, meta }: { href: string; label: string; icon: React.ReactNode; exact?: boolean; meta?: string }) {
  const p = usePathname();
  const active = exact ? p === href : p === href || p.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "mt-0.5 flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors max-lg:whitespace-nowrap",
        active ? "bg-cx-active font-medium text-cx-text" : "text-cx-text-2 hover:bg-cx-raised hover:text-cx-text",
      )}
    >
      <span className={cn("flex w-4 shrink-0 justify-center", active ? "text-cx-text" : "text-cx-muted")}>{icon}</span>
      <span className="truncate">{label}</span>
      {meta && <span className="ml-auto text-[11.5px] text-cx-faint max-lg:hidden">{meta}</span>}
    </Link>
  );
}
