import Link from "next/link";

// Server-rendered, data-dense table + the bits around it. No client JS: search
// and paging are plain GET forms and links, so large tenants stay fast.

export type Col<T> = {
  key: string;
  label: string;
  align?: "right" | "center";
  width?: string;
  render: (row: T) => React.ReactNode;
};

export function ConsoleTable<T>({ columns, rows, rowKey, empty = "Nothing here yet." }: {
  columns: Col<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hair bg-white">
      <table className="w-full text-[13px]">
        <thead className="border-b border-hair bg-[#FAFBFC] text-[11px] uppercase tracking-wide text-ink-500">
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ width: col.width }} className={`px-3.5 py-2 font-medium ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-[#FAFBFC]">
              {columns.map((col) => (
                <td key={col.key} className={`px-3.5 py-2 ${col.align === "right" ? "text-right tabular-nums" : col.align === "center" ? "text-center" : ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3.5 py-12 text-center text-[13px] text-ink-500">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SearchForm({ action, defaultValue, placeholder = "Search…", hidden = {}, children }: {
  action: string;
  defaultValue?: string;
  placeholder?: string;
  hidden?: Record<string, string | undefined>;
  children?: React.ReactNode;
}) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative min-w-[200px] flex-1">
        <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input name="q" defaultValue={defaultValue} placeholder={placeholder} className="w-full rounded-md border border-hair bg-white py-1.5 pl-8 pr-3 text-[13px] text-ink-900 outline-none placeholder:text-ink-400 focus:border-[#0F6CBD] focus:ring-2 focus:ring-[#0F6CBD]/15" />
      </div>
      {children}
      <button className="rounded-md border border-hair bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-panel">Search</button>
    </form>
  );
}

export function Pager({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink-500">
      <span className="tabular-nums">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        {page > 1 ? <Link href={hrefFor(page - 1)} className="rounded-md border border-hair px-2.5 py-1 font-medium text-ink-700 hover:bg-panel">Prev</Link> : <span className="rounded-md border border-hair px-2.5 py-1 text-ink-300">Prev</span>}
        <span className="px-2 tabular-nums">Page {page} / {pages}</span>
        {page < pages ? <Link href={hrefFor(page + 1)} className="rounded-md border border-hair px-2.5 py-1 font-medium text-ink-700 hover:bg-panel">Next</Link> : <span className="rounded-md border border-hair px-2.5 py-1 text-ink-300">Next</span>}
      </div>
    </div>
  );
}

export function ZoneHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-ink-900">{title}</h1>
        {sub && <p className="mt-0.5 text-[12.5px] text-ink-500">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Avatar({ src, name, size = 30 }: { src?: string | null; name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- tenant CDN photo, dynamic
    return <img src={src} alt={name} width={size} height={size} className="shrink-0 rounded-md object-cover ring-1 ring-hair" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md bg-panel text-[10.5px] font-semibold uppercase text-ink-500 ring-1 ring-hair" style={{ width: size, height: size }}>
      {initials}
    </span>
  );
}

export function Kpi({ label, value, sub, href }: { label: string; value: string | number; sub?: string; href?: string }) {
  const inner = (
    <div className={`rounded-lg border border-hair bg-white p-3.5 ${href ? "transition-colors hover:border-[#0F6CBD]/40 hover:bg-[#0F6CBD]/[0.02]" : ""}`}>
      <p className="text-[11.5px] font-medium text-ink-500">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums text-ink-900">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-400">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "sky" | "violet" | "rose" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
    sky: "bg-sky-50 text-sky-700 ring-sky-600/20",
    violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
    rose: "bg-rose-50 text-rose-700 ring-rose-600/20",
  };
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ring-1 ${tones[tone]}`}>{children}</span>;
}
