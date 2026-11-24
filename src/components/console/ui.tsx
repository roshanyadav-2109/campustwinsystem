// Console primitives. Server-safe. One graphite ramp, one link colour, no tinted pills.

export const inputCls =
  "w-full rounded-md border border-cx-line-strong bg-cx-card px-2.5 py-1.5 text-[13.5px] text-cx-text outline-none transition-colors placeholder:text-cx-faint focus:border-cx-text focus:ring-1 focus:ring-cx-text";
export const labelCls = "mb-1 block text-[12.5px] font-medium text-cx-text-2";
export const btnPrimary =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-cx-text px-3 text-[13px] font-medium text-white transition-colors hover:bg-black active:scale-[0.98] disabled:opacity-50";
export const btnGhost =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-cx-line-strong bg-cx-card px-3 text-[13px] font-medium text-cx-text transition-colors hover:bg-cx-raised active:scale-[0.98]";
export const btnDanger =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-cx-line-strong bg-cx-card px-3 text-[13px] font-medium text-cx-bad transition-colors hover:bg-cx-raised active:scale-[0.98]";

export function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "off" }) {
  const c = { ok: "bg-cx-ok", warn: "bg-cx-warn", bad: "bg-cx-bad", off: "bg-cx-faint" }[tone];
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />;
}

export function StatusBadge({ status }: { status: string }) {
  const on = status === "active";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-cx-text-2">
      <Dot tone={on ? "ok" : "warn"} />
      {on ? "Active" : "Suspended"}
    </span>
  );
}

export function TypeBadge({ kind }: { kind: string }) {
  const label = kind === "university" ? "University" : kind === "campus" ? "Campus" : "School";
  return <span className="whitespace-nowrap text-[13px] text-cx-text-2">{label}</span>;
}

// A container in the AWS sense: a titled panel with a hairline under the header.
export function Section({ title, desc, right, children, flush }: { title?: string; desc?: string; right?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-cx-line bg-cx-card">
      {title && <div className="flex items-center justify-between gap-4 border-b border-cx-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold leading-6 text-cx-text">{title}</h2>
          {desc && <p className="mt-0.5 text-[13px] text-cx-muted">{desc}</p>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

// Empty state as a real card: what this area is for, and the one next step.
export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-cx-line bg-cx-card px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cx-raised text-cx-text-2">{icon}</span>
      <h2 className="mt-4 text-[16px] font-semibold text-cx-text">{title}</h2>
      <p className="mt-1.5 max-w-md text-[13.5px] leading-5 text-cx-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// Kept for pages that still call it; the breadcrumb trail replaces the old back link.
export function PageHeader({ title, badge, subdomain, children }: {
  title: string; badge?: React.ReactNode; subdomain?: string; backHref?: string; backLabel?: string; children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-[20px] font-semibold leading-7 text-cx-text">{title}</h1>
        {(badge || subdomain) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13px] text-cx-muted">
            {badge}
            {subdomain && <a href={`https://${subdomain}`} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-cx-link hover:underline">{subdomain}</a>}
          </div>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
