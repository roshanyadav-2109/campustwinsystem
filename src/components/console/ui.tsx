import Link from "next/link";

// Shared primitives for the company console. Kept server-safe (no "use client")
// so pages can compose them freely. One visual system across every console page.

export const inputCls =
  "w-full rounded-md border border-hair bg-white px-3 py-2 text-[13.5px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-[#0F6CBD] focus:ring-2 focus:ring-[#0F6CBD]/15";
export const labelCls = "block text-[12px] font-medium text-ink-700 mb-1.5";
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[#0F6CBD] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#0B5CA3] disabled:opacity-50";
export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-hair bg-white px-3 py-2 text-[13px] font-medium text-ink-700 transition-colors hover:bg-panel";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-2 text-[13px] font-medium text-rose-700 transition-colors hover:bg-rose-50";

export function StatusBadge({ status }: { status: string }) {
  const on = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
        on ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20" : "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-amber-500"}`} />
      {on ? "Active" : "Suspended"}
    </span>
  );
}

export function TypeBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    university: "bg-violet-50 text-violet-700 ring-violet-600/20",
    campus: "bg-sky-50 text-sky-700 ring-sky-600/20",
    school: "bg-slate-100 text-slate-600 ring-slate-500/20",
  };
  const label = kind === "university" ? "University" : kind === "campus" ? "Campus" : "School";
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${map[kind] ?? map.school}`}>{label}</span>;
}

export function Section({ title, desc, right, children }: { title: string; desc?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-hair bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-hair px-4 py-2.5">
        <div>
          <h2 className="text-[13.5px] font-semibold text-ink-900">{title}</h2>
          {desc && <p className="mt-0.5 text-[12px] text-ink-500">{desc}</p>}
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  badge,
  subdomain,
  backHref = "/console",
  backLabel = "Institutions",
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  subdomain?: string;
  backHref?: string;
  backLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {backHref !== "" && <Link href={backHref} className="text-[12px] text-ink-500 transition-colors hover:text-[#0F6CBD]">&larr; {backLabel}</Link>}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate text-[19px] font-semibold tracking-tight text-ink-900">{title}</h1>
            {badge}
          </div>
          {subdomain && (
            <a href={`https://${subdomain}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-[13px] text-[#0F6CBD] hover:underline">
              {subdomain} ↗
            </a>
          )}
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
