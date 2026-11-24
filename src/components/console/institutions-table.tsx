"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { StatusBadge, TypeBadge } from "./ui";

export type InstRow = {
  id: number;
  kind: "university" | "campus" | "school";
  name: string;
  slug: string;
  parent: string | null;
  plan: string | null;
  status: string;
  students: number;
  staff: number;
  href: string;
  url: string;
};

type SortKey = "name" | "students" | "staff";
const FILTERS = [
  { key: "all", label: "All" },
  { key: "university", label: "Universities" },
  { key: "campus", label: "Campuses" },
  { key: "school", label: "Schools" },
] as const;
const n = (v: number) => v.toLocaleString("en-IN");

export function InstitutionsTable({ rows, initialQuery = "" }: { rows: InstRow[]; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery);
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<1 | -1>(1);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = rows.filter((x) => (filter === "all" ? true : x.kind === filter));
    if (needle) r = r.filter((x) => `${x.name} ${x.slug} ${x.parent ?? ""} ${x.plan ?? ""}`.toLowerCase().includes(needle));
    return [...r].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : a[sort] - b[sort]) * dir);
  }, [rows, q, filter, sort, dir]);

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(k); setDir(k === "name" ? 1 : -1); }
  };
  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`h-9 px-3 font-medium ${right ? "text-right" : "text-left"}`} aria-sort={sort === k ? (dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 text-cx-muted transition-colors hover:text-cx-text">
        {children}
        {sort === k && (dir === 1 ? <Icon name="arrow-up" size={12} /> : <Icon name="arrow-down" size={12} />)}
      </button>
    </th>
  );

  return (
    <section className="rounded-lg border border-cx-line bg-cx-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cx-line px-4 py-2.5">
        <h2 className="text-[14px] font-semibold text-cx-text">
          Institutions <span className="font-normal tabular-nums text-cx-muted">({shown.length})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cx-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name or address"
              className="h-8 w-64 rounded-md border border-cx-line-strong bg-cx-card pl-8 pr-3 text-[13px] text-cx-text outline-none transition-colors placeholder:text-cx-faint focus:border-cx-text focus:ring-1 focus:ring-cx-text"
            />
          </div>
          <div className="flex h-8 items-center rounded-md border border-cx-line-strong bg-cx-raised p-0.5" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`h-full rounded px-2.5 text-[12.5px] transition-colors ${filter === f.key ? "bg-cx-card font-medium text-cx-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-cx-muted hover:text-cx-text"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead className="border-b border-cx-line bg-cx-raised/60 text-[12.5px]">
            <tr>
              <Th k="name">Name</Th>
              <th className="h-9 px-3 text-left font-medium text-cx-muted">Type</th>
              <th className="h-9 px-3 text-left font-medium text-cx-muted">Address</th>
              <th className="h-9 px-3 text-left font-medium text-cx-muted">Plan</th>
              <Th k="students" right>Students</Th>
              <Th k="staff" right>Staff</Th>
              <th className="h-9 px-3 text-left font-medium text-cx-muted">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cx-line">
            {shown.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="transition-colors hover:bg-cx-raised/50">
                <td className="h-11 px-3">
                  <Link href={r.href} className="font-medium text-cx-link hover:underline">{r.name}</Link>
                  {r.parent && <div className="text-[12px] text-cx-muted">{r.parent}</div>}
                </td>
                <td className="px-3"><TypeBadge kind={r.kind} /></td>
                <td className="px-3">
                  <a href={`https://${r.url}`} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-cx-text-2 hover:text-cx-link hover:underline">{r.slug}</a>
                </td>
                <td className="px-3 capitalize text-cx-text-2">{r.plan ?? "—"}</td>
                <td className="px-3 text-right tabular-nums text-cx-text">{n(r.students)}</td>
                <td className="px-3 text-right tabular-nums text-cx-text">{n(r.staff)}</td>
                <td className="px-3"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-[13px] text-cx-muted">No institutions match “{q}”</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
