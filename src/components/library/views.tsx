import Link from "@/components/ui/hover-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/utils";
import { FinePaidButton, ReturnControls } from "./library-ui";
import { fmtDay, fmtMoney, plural, tabCls, tdCls, thCls, type Loan } from "./shared";

// Server-rendered pieces of the Library tab. Searching and paging live in the
// address bar, so these are plain forms and links.

const BASE = "/dashboard/library";

export function hrefFor(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  const qs = sp.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

export function ViewTabs({ view, items }: { view: string; items: { key: string; label: string }[] }) {
  return (
    <nav aria-label="Library sections" className="mb-5 flex flex-wrap gap-2">
      {items.map((it) => (
        <Link key={it.key} prefetch={false} href={hrefFor({ view: it.key })} className={tabCls(view === it.key)}
          aria-current={view === it.key ? "page" : undefined}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export function SearchBar({ view, q, placeholder, categories, category, extra }: {
  view: string; q: string; placeholder: string; categories?: string[]; category?: string | null; extra?: Record<string, string>;
}) {
  const filtered = !!q || !!category;
  return (
    <form action={BASE} method="get" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="view" value={view} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Input name="q" defaultValue={q} maxLength={60} placeholder={placeholder} aria-label="Search" className="w-full sm:w-80" />
      {categories && categories.length > 0 && (
        <Select name="cat" defaultValue={category ?? ""} aria-label="Category" className="w-full sm:w-48">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      )}
      <Button type="submit" variant="subtle">Search</Button>
      {filtered && <Link prefetch={false} href={hrefFor({ view, ...(extra ?? {}) })} className="text-[13px] font-medium text-[#0F6CBD] hover:underline">Clear</Link>}
    </form>
  );
}

export function Pager({ page, pageSize, total, params }: { page: number; pageSize: number; total: number; params: Record<string, string | null | undefined> }) {
  if (total <= pageSize) return null;
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  const link = "text-[13px] font-medium text-[#0F6CBD] hover:underline";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-hair px-4 py-2.5">
      <span className="text-[13px] tabular text-ink-500">{from} to {to} of {total}</span>
      <span className="flex gap-4">
        {page > 0 && <Link prefetch={false} href={hrefFor({ ...params, page: page - 1 || null })} className={link}>Previous</Link>}
        {page < last && <Link prefetch={false} href={hrefFor({ ...params, page: page + 1 })} className={link}>Next</Link>}
      </span>
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody>
        <div className="t-label">{label}</div>
        <div className="t-display mt-1 tabular text-ink-900">{value}</div>
        {hint && <p className="mt-1 text-[12px] text-ink-500">{hint}</p>}
      </CardBody>
    </Card>
  );
}

function MemberCell({ l }: { l: Loan }) {
  return (
    <td className={tdCls}>
      <div className="font-medium">{l.member_name}</div>
      <div className="text-[12px] text-ink-500">
        {l.member_kind === "student"
          ? [l.class_section, l.admission_no ? `Adm. no ${l.admission_no}` : null].filter(Boolean).join(" · ") || "Student"
          : "Staff"}
      </div>
    </td>
  );
}

function BookCell({ l }: { l: Loan }) {
  return (
    <td className={tdCls}>
      <div className="font-medium">{l.title}</div>
      <div className="text-[12px] tabular text-ink-500">{l.accession_no}</div>
    </td>
  );
}

const lateText = (n: number) => plural(n, "day", "days");

// Books out right now. `canReturn` adds the Return control (office).
export function LoansOutTable({ loans, canReturn }: { loans: Loan[]; canReturn: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="border-b border-hair">
            <th className={thCls}>Member</th>
            <th className={thCls}>Book</th>
            <th className={thCls}>Issued</th>
            <th className={thCls}>Due</th>
            <th className={thCls}>Late</th>
            <th className={thCls}>Fine so far</th>
            {canReturn && <th className={thCls}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id} className="border-b border-hair last:border-b-0">
              <MemberCell l={l} />
              <BookCell l={l} />
              <td className={cn(tdCls, "tabular whitespace-nowrap")}>{fmtDay(l.issued_on)}</td>
              <td className={cn(tdCls, "tabular whitespace-nowrap")}>{fmtDay(l.due_on)}</td>
              <td className={cn(tdCls, "whitespace-nowrap")}>
                {l.days_late > 0 ? <StatusPill status="down">{lateText(l.days_late)}</StatusPill> : <span className="text-ink-500">On time</span>}
              </td>
              <td className={cn(tdCls, "tabular whitespace-nowrap")}>{l.fine > 0 ? fmtMoney(l.fine) : "—"}</td>
              {canReturn && (
                <td className={cn(tdCls, "text-right")}>
                  <ReturnControls issueId={l.id} daysLate={l.days_late} fine={l.fine} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Returned books whose fine is still to be collected.
export function FinesDueTable({ loans }: { loans: Loan[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead>
          <tr className="border-b border-hair">
            <th className={thCls}>Member</th>
            <th className={thCls}>Book</th>
            <th className={thCls}>Returned</th>
            <th className={thCls}>Late</th>
            <th className={thCls}>Fine</th>
            <th className={thCls}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id} className="border-b border-hair last:border-b-0">
              <MemberCell l={l} />
              <BookCell l={l} />
              <td className={cn(tdCls, "tabular whitespace-nowrap")}>{fmtDay(l.returned_on)}</td>
              <td className={cn(tdCls, "whitespace-nowrap")}>{lateText(l.days_late)}</td>
              <td className={cn(tdCls, "tabular whitespace-nowrap font-semibold")}>{fmtMoney(l.fine)}</td>
              <td className={cn(tdCls, "text-right")}><FinePaidButton issueId={l.id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OverdueTable({ loans }: { loans: Loan[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="border-b border-hair">
            <th className={thCls}>Member</th>
            <th className={thCls}>Class</th>
            <th className={thCls}>Book</th>
            <th className={thCls}>Due</th>
            <th className={thCls}>Days late</th>
            <th className={thCls}>Fine so far</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id} className="border-b border-hair last:border-b-0">
              <td className={tdCls}>
                <div className="font-medium">{l.member_name}</div>
                <div className="text-[12px] text-ink-500">{l.member_kind === "student" ? (l.admission_no ? `Adm. no ${l.admission_no}` : "Student") : "Staff"}</div>
              </td>
              <td className={cn(tdCls, "whitespace-nowrap")}>{l.class_section ?? "—"}</td>
              <BookCell l={l} />
              <td className={cn(tdCls, "tabular whitespace-nowrap")}>{fmtDay(l.due_on)}</td>
              <td className={cn(tdCls, "tabular whitespace-nowrap")}>{l.days_late}</td>
              <td className={cn(tdCls, "tabular whitespace-nowrap font-semibold")}>{fmtMoney(l.fine)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A member's own books: what they hold now, then what they have returned.
export function MyBooks({ current, history, limit }: { current: Loan[]; history: Loan[]; limit: number }) {
  const overdue = current.filter((l) => l.days_late > 0).length;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Books with me" action={<span className="text-[13px] tabular text-ink-500">{current.length} of {limit} allowed</span>} />
        {current.length === 0 ? (
          <CardBody><p className="text-[14px] text-ink-500">You do not have any library books right now.</p></CardBody>
        ) : (
          <>
            {overdue > 0 && (
              <p role="alert" className="border-b border-hair px-4 py-2.5 text-[13px] font-medium text-down">
                {plural(overdue, "book is", "books are")} overdue. Please return {overdue === 1 ? "it" : "them"} to the library. The fine grows each day.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr className="border-b border-hair">
                    <th className={thCls}>Book</th>
                    <th className={thCls}>Issued</th>
                    <th className={thCls}>Due</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Fine so far</th>
                  </tr>
                </thead>
                <tbody>
                  {current.map((l) => (
                    <tr key={l.id} className="border-b border-hair last:border-b-0">
                      <td className={tdCls}>
                        <div className="font-medium">{l.title}</div>
                        <div className="text-[12px] text-ink-500">{[l.author, l.accession_no].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className={cn(tdCls, "tabular whitespace-nowrap")}>{fmtDay(l.issued_on)}</td>
                      <td className={cn(tdCls, "tabular whitespace-nowrap")}>{fmtDay(l.due_on)}</td>
                      <td className={cn(tdCls, "whitespace-nowrap")}>
                        {l.days_late > 0
                          ? <StatusPill status="down">Overdue by {lateText(l.days_late)}</StatusPill>
                          : <span className="text-ink-500">On time</span>}
                      </td>
                      <td className={cn(tdCls, "tabular whitespace-nowrap")}>{l.fine > 0 ? fmtMoney(l.fine) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Books I have returned" />
        {history.length === 0 ? (
          <CardBody><p className="text-[14px] text-ink-500">Nothing returned yet.</p></CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr className="border-b border-hair">
                  <th className={thCls}>Book</th>
                  <th className={thCls}>Issued</th>
                  <th className={thCls}>Returned</th>
                  <th className={thCls}>Fine</th>
                </tr>
              </thead>
              <tbody>
                {history.map((l) => (
                  <tr key={l.id} className="border-b border-hair last:border-b-0">
                    <td className={tdCls}>
                      <div className="font-medium">{l.title}</div>
                      <div className="text-[12px] text-ink-500">{[l.author, l.accession_no].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className={cn(tdCls, "tabular whitespace-nowrap")}>{fmtDay(l.issued_on)}</td>
                    <td className={cn(tdCls, "tabular whitespace-nowrap")}>{fmtDay(l.returned_on)}</td>
                    <td className={cn(tdCls, "whitespace-nowrap")}>
                      {l.fine > 0 ? (
                        <span className="tabular">{fmtMoney(l.fine)} <span className={l.fine_paid ? "text-ink-500" : "font-medium text-down"}>{l.fine_paid ? "paid" : "to pay"}</span></span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
