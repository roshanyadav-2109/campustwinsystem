"use client";
import Link from "@/components/ui/hover-link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Tabs inside one Settings section, each its own address.
export function SubTabs({ label, items }: { label: string; items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mb-5 flex flex-wrap gap-1.5 border-b border-hair pb-3">
      {items.map((i) => {
        const on = pathname === i.href;
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={cn("rounded-sm border px-3.5 py-2 text-[14px] font-medium transition-colors",
              on ? "border-[#0F6CBD] bg-[#EBF3FC] font-semibold text-[#0F6CBD]" : "border-hair bg-surface text-ink-700 hover:border-[#B4D6FA] hover:bg-[#F5F9FE]")}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
