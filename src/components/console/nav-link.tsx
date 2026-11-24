"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ConsoleNavLink({ href, label, icon, exact }: { href: string; label: string; icon: React.ReactNode; exact?: boolean }) {
  const p = usePathname();
  const active = exact ? p === href : p === href || p.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
        active ? "bg-[#0F6CBD]/10 text-[#0F6CBD]" : "text-ink-600 hover:bg-panel hover:text-ink-900",
      )}
    >
      <span className={cn("shrink-0", active ? "text-[#0F6CBD]" : "text-ink-400")}>{icon}</span>
      {label}
    </Link>
  );
}
