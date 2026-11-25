// Server-safe building blocks, in the Eternity console style.

export const inputBase =
  "rounded-md border border-cx-line-strong bg-cx-card px-2.5 py-1.5 text-[13.5px] text-cx-text outline-none transition-colors placeholder:text-cx-faint focus:border-cx-text focus:ring-1 focus:ring-cx-text disabled:bg-cx-raised";
// Full-width field for forms; inline filters use inputBase with their own width.
export const inputCls = "w-full " + inputBase;
export const labelCls = "mb-1 block text-[12.5px] font-medium text-cx-text-2";
export const btnPrimary =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-cx-text px-3 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-50";
export const btnGhost =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-cx-line-strong bg-cx-card px-3 text-[13px] font-medium text-cx-text transition-colors hover:bg-cx-raised disabled:opacity-50";
export const btnDanger =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-cx-line-strong bg-cx-card px-3 text-[13px] font-medium text-cx-bad transition-colors hover:bg-cx-raised disabled:opacity-50";
export const linkCls = "font-medium text-cx-link hover:underline";
// Destructive action in a list: quiet until hovered, so rows are not a wall of red.
export const btnQuiet = "text-[13px] text-cx-muted underline-offset-2 transition-colors hover:text-cx-bad hover:underline disabled:opacity-50";

export function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "off" }) {
  const c = { ok: "bg-cx-ok", warn: "bg-cx-warn", bad: "bg-cx-bad", off: "bg-cx-faint" }[tone];
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />;
}

export function Status({ tone, children }: { tone: "ok" | "warn" | "bad" | "off"; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-cx-text-2"><Dot tone={tone} />{children}</span>;
}

export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-[22px] font-semibold leading-8 text-cx-text">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-cx-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Section({ title, desc, right, children, flush }: { title?: string; desc?: string; right?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-cx-line bg-cx-card">
      {title && (
        <div className="flex items-center justify-between gap-4 border-b border-cx-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-6 text-cx-text">{title}</h2>
            {desc && <p className="mt-0.5 text-[13px] text-cx-muted">{desc}</p>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 text-center text-[13.5px] text-cx-muted">{children}</p>;
}

export function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-cx-card px-5 py-4">
      <p className="text-[12.5px] text-cx-muted">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-8 tabular-nums text-cx-text">{value}</p>
      {sub && <p className="text-[12px] text-cx-faint">{sub}</p>}
    </div>
  );
}
export const kpiStrip =
  "mb-4 grid gap-px overflow-hidden rounded-lg border border-cx-line bg-cx-line [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]";

// Plain table: header row, hairline rows, first and last cells padded to the card edge.
export function Table({ head, children }: { head: { label: string; right?: boolean }[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-cx-line text-left">
            {head.map((h) => (
              <th key={h.label} scope="col" className={`whitespace-nowrap px-3 py-2.5 text-[12.5px] font-medium text-cx-muted first:pl-5 last:pr-5 ${h.right ? "text-right" : ""}`}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cx-line">{children}</tbody>
      </table>
    </div>
  );
}
export const td = "px-3 py-2.5 align-middle text-cx-text-2 first:pl-5 last:pr-5";
