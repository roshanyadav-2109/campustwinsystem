import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, modulesOf } from "@/lib/console/tenant";
import { Kpi, ZoneHeader, kpiStrip, ConsoleTable, Pill, type Col } from "@/components/console/table";
import { EmptyState, Section, btnGhost } from "@/components/console/ui";
import { ModuleNotice } from "@/components/console/module-notice";
import { MeterList } from "@/components/console/meter-list";
import { Icon } from "@/components/console/icons";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const TODAY = new Date().toISOString().slice(0, 10);
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
type Book = { id: number; category: string; copies_total: number };
type Loan = { id: number; issued_on: string; due_on: string; fine_amount: number; book: { title: string } | null; student: { full_name: string; admission_no: string } | null; staff: { full_name: string } | null };

export default async function LibraryZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const on = !!modulesOf(s.modules).library;
  const [{ data: bookData }, { data: loanData }, { count: totalLoans }] = await Promise.all([
    admin.from("library_book").select("id, category, copies_total").eq("school_id", s.id).eq("is_active", true).limit(20000),
    admin.from("library_issue").select("id, issued_on, due_on, fine_amount, book:book_id(title), student:student_id(full_name, admission_no), staff:staff_id(full_name)").eq("school_id", s.id).is("returned_on", null).order("due_on").limit(500),
    admin.from("library_issue").select("*", { count: "exact", head: true }).eq("school_id", s.id),
  ]);
  const books = (bookData ?? []) as Book[];
  const loans = (loanData ?? []) as unknown as Loan[];

  if (books.length === 0) {
    return (
      <div>
        <ZoneHeader title="Library" />
        {!on && <ModuleNotice module="library" schoolId={s.id} />}
        <EmptyState
          icon={<Icon name="library" size={22} />}
          title="No books catalogued yet"
          body={`${s.name} hasn't added its catalogue. Once the librarian adds titles and starts issuing books, stock and loans show here.`}
          action={on ? <a href={`https://${s.slug}.${BASE}/dashboard/library`} target="_blank" rel="noreferrer" className={btnGhost}>Open the library in the school portal <Icon name="external" size={14} /></a> : undefined}
        />
      </div>
    );
  }

  const copies = books.reduce((t, b) => t + b.copies_total, 0);
  const overdue = loans.filter((l) => l.due_on < TODAY);
  const byCategory = Object.entries(books.reduce<Record<string, number>>((m, b) => ((m[b.category] = (m[b.category] ?? 0) + b.copies_total), m), {})).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));

  const cols: Col<Loan>[] = [
    { key: "b", label: "Book", render: (l) => <span className="font-medium text-cx-text">{l.book?.title ?? ""}</span> },
    { key: "w", label: "Borrowed by", render: (l) => l.student ? <div><div>{l.student.full_name}</div><div className="text-[12px] text-cx-muted">{l.student.admission_no}</div></div> : l.staff?.full_name ?? "" },
    { key: "i", label: "Issued", render: (l) => <span className="tabular-nums">{fmt(l.issued_on)}</span> },
    { key: "d", label: "Due back", render: (l) => <span className="tabular-nums">{fmt(l.due_on)}</span> },
    { key: "s", label: "Status", render: (l) => l.due_on < TODAY ? <Pill tone="amber">Overdue</Pill> : <Pill tone="green">On loan</Pill> },
  ];

  return (
    <div>
      <ZoneHeader title="Library" />
      {!on && <ModuleNotice module="library" schoolId={s.id} />}

      <div className={kpiStrip}>
        <Kpi label="Titles" value={books.length} sub={`${copies.toLocaleString("en-IN")} copies`} />
        <Kpi label="On loan now" value={loans.length} />
        <Kpi label="Overdue" value={overdue.length} />
        <Kpi label="Loans so far" value={totalLoans ?? 0} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title="Books out right now" desc="Overdue first, then by due date" flush>
            <ConsoleTable bare columns={cols} rows={[...overdue, ...loans.filter((l) => l.due_on >= TODAY)]} rowKey={(l) => l.id} empty="Every book is on the shelf" />
          </Section>
        </div>
        <Section title="Copies by category" flush>
          <MeterList rows={byCategory} max={Math.max(1, ...byCategory.map((c) => c.value))} format={(v) => String(v)} />
        </Section>
      </div>
    </div>
  );
}
