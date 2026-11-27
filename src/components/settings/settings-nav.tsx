"use client";
import Link from "@/components/ui/hover-link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// The side list inside Settings: one entry per section this person may open.
export function SettingsNav({ title, items }: { title: string; items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={title} className="lg:sticky lg:top-4">
      <div className="mb-2 px-3 text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {items.map((i) => {
          const on = pathname === i.href || pathname.startsWith(`${i.href}/`);
          return (
            <li key={i.href} className="shrink-0">
              <Link href={i.href} aria-current={on ? "page" : undefined}
                className={cn("block rounded-sm px-3 py-2 text-[14px] transition-colors",
                  on ? "bg-[#EBF3FC] font-semibold text-[#0F6CBD]" : "text-ink-700 hover:bg-panel hover:text-ink-900")}>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
