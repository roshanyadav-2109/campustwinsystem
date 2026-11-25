"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";

// Sidebar entry. Selected = grey fill and darker text, never a coloured pill.
export function NavLink({ href, icon, label, exact }: { href: string; icon: IconName; label: string; exact?: boolean }) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-1.5 text-[13.5px] transition-colors ${
        on ? "bg-cx-sel font-medium text-cx-text" : "text-cx-text-2 hover:bg-cx-hover hover:text-cx-text"
      }`}
    >
      <Icon name={icon} size={18} className="shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
