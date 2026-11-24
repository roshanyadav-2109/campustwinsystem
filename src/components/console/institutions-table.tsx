"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
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

export function InstitutionsTable({ rows }: { rows: InstRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<1 | -1>(1);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = rows.filter((x) => (filter === "all" ? true : x.kind === filter));
    if (needle) r = r.filter((x) => `${x.name} ${x.slug} ${x.parent ?? ""} ${x.plan ?? ""}`.toLowerCase().includes(needle));
    r = [...r].sort((a, b) => {
      const v = sort === "name" ? a.name.localeCompare(b.name) : a[sort] - b[sort];
      return v * dir;
    });
    return r;
  }, [rows, q, filter, sort, dir]);

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(k); setDir(k === "name" ? 1 : -1); }
  };
  const caret = (k: SortKey) => (sort === k ? (dir === 1 ? " ↑" : " ↓") : "");
  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-4 py-2.5 font-medium ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center text-ink-500 transition-colors hover:text-ink-900">
        {children}<span className="text-[#0F6CBD]">{caret(k)}</span>
      </button>
    </th>
  );

  return (
    <div className="rounded-xl border border-hair bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-hair p-3">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search institutions…"
            className="w-full rounded-md border border-hair bg-white py-2 pl-9 pr-3 text-[13.5px] text-ink-900 outline-none placeholder:text-ink-400 focus:border-[#0F6CBD] focus:ring-2 focus:ring-[#0F6CBD]/15"
          />
        </div>
        <div className="flex items-center gap-0.5 rounded-md bg-panel p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${filter === f.key ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-b border-hair bg-[#FAFBFC] text-[11.5px] uppercase tracking-wide">
            <tr>
              <Th k="name">Institution</Th>
              <th className="px-4 py-2.5 text-left font-medium text-ink-500">Type</th>
              <th className="px-4 py-2.5 text-left font-medium text-ink-500">Subdomain</th>
              <th className="px-4 py-2.5 text-left font-medium text-ink-500">Plan</th>
              <Th k="students" right>Students</Th>
              <Th k="staff" right>Staff</Th>
              <th className="px-4 py-2.5 text-left font-medium text-ink-500">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {shown.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="group hover:bg-[#FAFBFC]">
                <td className="px-4 py-2.5">
                  <Link href={r.href} className="font-medium text-ink-900 hover:text-[#0F6CBD]">{r.name}</Link>
                  {r.parent && <div className="text-[11.5px] text-ink-400">{r.parent}</div>}
                </td>
                <td className="px-4 py-2.5"><TypeBadge kind={r.kind} /></td>
                <td className="px-4 py-2.5">
                  <a href={`https://${r.url}`} target="_blank" rel="noreferrer" className="text-[#0F6CBD] hover:underline">{r.slug}</a>
                </td>
                <td className="px-4 py-2.5 capitalize text-ink-600">{r.plan ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{r.kind === "university" || r.students ? r.students.toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{r.kind === "university" || r.staff ? r.staff.toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={r.href} className="rounded-md border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-600 opacity-0 transition-opacity hover:bg-panel group-hover:opacity-100">Manage</Link>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-[13px] text-ink-500">No institutions match “{q}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
