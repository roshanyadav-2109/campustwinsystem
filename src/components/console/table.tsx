import Link from "@/components/ui/hover-link";
import { Icon } from "./icons";
import { Dot } from "./ui";

// Server-rendered, data-dense table + the bits around it. Search and paging are
// plain GET forms and links, so large tenants stay fast and work without JS.

export type Col<T> = {
  key: string;
  label: string;
  align?: "right" | "center";
  width?: string;
  render: (row: T) => React.ReactNode;
};

export function ConsoleTable<T>({ columns, rows, rowKey, empty = "Nothing here yet", bare }: {
  columns: Col<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: string;
  bare?: boolean;
}) {
  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  return (
    <div className={bare ? "overflow-x-auto" : "overflow-x-auto rounded-lg border border-cx-line bg-cx-card"}>
      <table className="w-full text-[13.5px]">
        <thead className="border-b border-cx-line bg-cx-raised/60">
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ width: col.width }} className={`h-10 whitespace-nowrap px-3 text-[13px] font-medium text-cx-text-2 first:pl-5 last:pr-5 ${align(col.align)}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cx-line">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="transition-colors hover:bg-cx-raised/50">
              {columns.map((col) => (
                <td key={col.key} className={`h-11 px-3 text-cx-text-2 first:pl-5 last:pr-5 ${align(col.align)} ${col.align === "right" ? "tabular-nums" : ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-[13px] text-cx-muted">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SearchForm({ action, defaultValue, placeholder = "Search", hidden = {}, children }: {
  action: string;
  defaultValue?: string;
  placeholder?: string;
  hidden?: Record<string, string | undefined>;
  children?: React.ReactNode;
}) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative min-w-[220px] max-w-md flex-1">
        <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cx-muted" />
        <input name="q" defaultValue={defaultValue} placeholder={placeholder} className="h-8 w-full rounded-md border border-cx-line-strong bg-cx-card pl-8 pr-3 text-[13.5px] text-cx-text outline-none transition-colors placeholder:text-cx-faint focus:border-cx-text focus:ring-1 focus:ring-cx-text" />
      </div>
      {children}
    </form>
  );
}

export function Pager({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = "flex h-7 w-7 items-center justify-center rounded-md border border-cx-line-strong bg-cx-card transition-colors";
  return (
    <div className="mt-2 flex items-center justify-between text-[12.5px] text-cx-muted">
      <span className="tabular-nums">{from.toLocaleString("en-IN")} to {to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</span>
      <div className="flex items-center gap-2">
        {page > 1
          ? <Link aria-label="Previous page" href={hrefFor(page - 1)} className={`${btn} text-cx-text hover:bg-cx-raised`}><Icon name="chevron-left" size={16} /></Link>
          : <span className={`${btn} text-cx-faint`}><Icon name="chevron-left" size={16} /></span>}
        {page < pages
          ? <Link aria-label="Next page" href={hrefFor(page + 1)} className={`${btn} text-cx-text hover:bg-cx-raised`}><Icon name="chevron-right" size={16} /></Link>
          : <span className={`${btn} text-cx-faint`}><Icon name="chevron-right" size={16} /></span>}
      </div>
    </div>
  );
}

// Page title row. Meta (type, status, address) sits on one quiet line under it.
export function ZoneHeader({ title, sub, badges, children }: { title: string; sub?: string; icon?: React.ReactNode; badges?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-[22px] font-semibold leading-8 text-cx-text">{title}</h1>
        {(badges || sub) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-cx-muted">
            {badges}
            {sub && <span>{sub}</span>}
          </div>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

// The session a page is reporting on, shown as a quiet control in the page header.
export function SessionTag({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-md border border-cx-line-strong bg-cx-card px-3 text-[13px] text-cx-text-2" aria-label={`Session ${name}`}>
      <Icon name="attendance" size={15} className="text-cx-muted" />
      {name}
    </span>
  );
}

export function Avatar({ src, name, size = 28 }: { src?: string | null; name: string; size?: number }) {
  const initials = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- tenant CDN photo, dynamic
    return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-md object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-md bg-cx-raised text-[11px] font-medium text-cx-muted" style={{ width: size, height: size }}>
      {initials}
    </span>
  );
}

// One joined summary strip of figures (AWS "Overview" container). Each cell is a number.
export const kpiStrip =
  "mb-4 grid gap-px overflow-hidden rounded-lg border border-cx-line bg-cx-line [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]";

export function Kpi({ label, value, sub, href }: { label: string; value: string | number; sub?: string; href?: string }) {
  const body = (
    <>
      <p className="text-[12.5px] text-cx-muted">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-8 tabular-nums text-cx-text">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</p>
      {sub && <p className="text-[12px] text-cx-faint">{sub}</p>}
    </>
  );
  return href
    ? <Link href={href} className="block bg-cx-card px-4 py-3 transition-colors hover:bg-cx-raised/60">{body}</Link>
    : <div className="bg-cx-card px-4 py-3">{body}</div>;
}

// Status gets a dot; categories (role, scope, stage) are plain text — no tinted tags.
export function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "sky" | "violet" | "rose" }) {
  const dot = tone === "green" ? "ok" : tone === "amber" ? "warn" : tone === "rose" ? "bad" : null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-cx-text-2">
      {dot && <Dot tone={dot} />}
      {children}
    </span>
  );
}
