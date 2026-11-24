"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

type Crumb = { label: string; href: string };

// Breadcrumbs: fixed trail from the layout, plus the current zone read from the URL.
export function Crumbs({ trail, base, zones }: { trail: Crumb[]; base: string; zones: Record<string, string> }) {
  const p = usePathname();
  const rest = p.startsWith(base) ? p.slice(base.length).split("/").filter(Boolean)[0] : undefined;
  const items: Crumb[] = [...trail];
  if (rest && zones[rest]) items.push({ label: zones[rest], href: `${base}/${rest}` });
  if (items.length < 2) return <div className="h-5" />;
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex h-5 items-center gap-1 overflow-hidden text-[12.5px]">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={c.href + i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <Icon name="chevron-right" size={12} className="shrink-0 text-cx-faint" />}
            {last ? (
              <span className="truncate text-cx-muted">{c.label}</span>
            ) : (
              <Link href={c.href} className="truncate text-cx-link hover:underline">{c.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
