import { getSession } from "@/lib/session";
import { guardTab } from "@/lib/access";
import { numParam, strParam } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  getCategories, getMemberLoans, getOpenLoans, getOverview, getSettings, getUnpaidFines, listBooks,
} from "@/lib/data/library";
import { CatalogueActions, CatalogueTable } from "@/components/library/catalogue";
import { IssueDesk } from "@/components/library/issue-desk";
import { OverdueDownload, SettingsForm } from "@/components/library/library-ui";
import {
  FinesDueTable, LoansOutTable, MyBooks, OverdueTable, Pager, SearchBar, StatTile, ViewTabs, hrefFor,
} from "@/components/library/views";
import { fmtMoney, plural, type LibrarySettings, type Loan, type MemberRef } from "@/components/library/shared";
import Link from "@/components/ui/hover-link";

type SP = Promise<Record<string, string | string[] | undefined>>;
type Params = Record<string, string | string[] | undefined>;

const TITLE = "Library";

const OFFICE_VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "catalogue", label: "Catalogue" },
  { key: "issue", label: "Issue" },
  { key: "return", label: "Return" },
  { key: "overdue", label: "Overdue" },
  { key: "settings", label: "Settings" },
];
const PRINCIPAL_VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "catalogue", label: "Catalogue" },
  { key: "overdue", label: "Overdue" },
];
const MEMBER_VIEWS = [
  { key: "mine", label: "My books" },
  { key: "catalogue", label: "Catalogue" },
];

// Library. The office runs it (catalogue, issue, return, fines, rules), the
// principal reads it, and students and teachers see their own books and can
// look up the catalogue.
export default async function LibraryPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/library");
  if (denied) return denied;
  const session = (await getSession())!;
  const sp = await searchParams;

  const settings = await getSettings();
  if (!settings) {
    return (
      <EmptyState art="coming-soon" title="The library is being set up"
        hint="Book issue and return, and the library catalogue, will appear here shortly." className="min-h-[60vh]" />
    );
  }

  const isOffice = session.staffRole === "office";
  const isPrincipal = session.staffRole === "principal";
  const member: MemberRef | null = session.studentId
    ? { kind: "student", id: session.studentId }
    : session.staffId ? { kind: "staff", id: session.staffId } : null;

  if (!isOffice && !isPrincipal && !member) {
    return <EmptyState art="no-access" title="The library is not available for this account" />;
  }

  const views = isOffice ? OFFICE_VIEWS : isPrincipal ? PRINCIPAL_VIEWS : MEMBER_VIEWS;
  const asked = strParam(sp.view);
  const view = views.some((v) => v.key === asked) ? (asked as string) : views[0].key;

  let body: React.ReactNode;
  if (view === "overview") body = await OverviewView({ settings });
  else if (view === "catalogue") body = await CatalogueView({ sp, canEdit: isOffice });
  else if (view === "issue") body = <IssueDesk />;
  else if (view === "return") body = await ReturnView({ sp, settings });
  else if (view === "overdue") body = await OverdueView({ settings });
  else if (view === "settings") body = <SettingsForm settings={settings} />;
  else body = await MineView({ member: member as MemberRef, settings });

  return (
    <div>
      <PageHeader title={TITLE} />
      <ViewTabs view={view} items={views} />
      {body}
    </div>
  );
}

async function OverviewView({ settings }: { settings: LibrarySettings }) {
  const o = await getOverview(settings.fine_per_day);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Titles" value={String(o.titles)} />
        <StatTile label="Copies" value={String(o.copies)} />
        <StatTile label="Books out now" value={String(o.outNow)} />
        <StatTile label="Overdue now" value={String(o.overdueNow)} />
        <StatTile label="Fines pending" value={fmtMoney(o.finesRecorded + o.finesBuilding)}
          hint={`${fmtMoney(o.finesRecorded)} on returned books, ${fmtMoney(o.finesBuilding)} building on overdue books`} />
      </div>
      <Card>
        <CardHeader title="Current rules" />
        <CardBody>
          <ul className="space-y-1 text-[14px] text-ink-900">
            <li>A student may hold {plural(settings.max_books_student, "book", "books")} for {plural(settings.loan_days_student, "day", "days")}.</li>
            <li>A staff member may hold {plural(settings.max_books_staff, "book", "books")} for {plural(settings.loan_days_staff, "day", "days")}.</li>
            <li>The fine is {fmtMoney(settings.fine_per_day)} for each day a book is late.</li>
          </ul>
          {o.overdueNow > 0 && (
            <p className="mt-3 text-[13px]">
              <Link prefetch={false} href={hrefFor({ view: "overdue" })} className="font-medium text-[#0F6CBD] hover:underline">See the overdue list</Link>
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

async function CatalogueView({ sp, canEdit }: { sp: Params; canEdit: boolean }) {
  const q = (strParam(sp.q) ?? "").trim().slice(0, 60);
  const showInactive = canEdit && strParam(sp.show) === "all";
  const page = Math.max(0, Math.floor(numParam(sp.page) ?? 0));
  const categories = await getCategories();
  const askedCat = strParam(sp.cat);
  const category = askedCat && categories.includes(askedCat) ? askedCat : null;
  const list = await listBooks({ q, category, page, includeInactive: showInactive });
  const extra: Record<string, string> = showInactive ? { show: "all" } : {};

  return (
    <Card>
      <CardHeader title="Catalogue" action={canEdit ? <CatalogueActions categories={categories} /> : undefined} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-4 py-3">
        <SearchBar view="catalogue" q={q} category={category} categories={categories} extra={extra}
          placeholder="Title, author, accession no or ISBN" />
        {canEdit && (
          <Link prefetch={false} className="text-[13px] font-medium text-[#0F6CBD] hover:underline"
            href={hrefFor({ view: "catalogue", q, cat: category, show: showInactive ? null : "all" })}>
            {showInactive ? "Hide books not in use" : "Show books not in use"}
          </Link>
        )}
      </div>
      {list.rows.length === 0 ? (
        <EmptyState art={q || category ? "no-results" : "nothing-yet"}
          title={q || category ? "No book matches that" : "No books in the catalogue yet"}
          hint={q || category ? "Try a shorter word, or clear the search." : canEdit ? "Use Add book to enter the first one." : "Books will show here once the office adds them."} />
      ) : (
        <>
          <CatalogueTable rows={list.rows} canEdit={canEdit} categories={categories} />
          <Pager page={list.page} pageSize={list.pageSize} total={list.total}
            params={{ view: "catalogue", q, cat: category, ...extra }} />
        </>
      )}
    </Card>
  );
}

function matches(l: Loan, q: string): boolean {
  const needle = q.toLowerCase();
  return [l.member_name, l.admission_no ?? "", l.accession_no, l.title, l.class_section ?? ""].some((s) => s.toLowerCase().includes(needle));
}

async function ReturnView({ sp, settings }: { sp: Params; settings: LibrarySettings }) {
  const q = (strParam(sp.q) ?? "").trim().slice(0, 60);
  const [open, unpaid] = await Promise.all([getOpenLoans(settings.fine_per_day), getUnpaidFines(settings.fine_per_day)]);
  const shown = q ? open.filter((l) => matches(l, q)) : open;
  const dues = q ? unpaid.filter((l) => matches(l, q)) : unpaid;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Books out now" action={<span className="text-[13px] tabular text-ink-500">{plural(shown.length, "book", "books")}</span>} />
        <div className="border-b border-hair px-4 py-3">
          <SearchBar view="return" q={q} placeholder="Member name, admission no or accession no" />
        </div>
        {shown.length === 0 ? (
          <EmptyState art={q ? "no-results" : "all-done"} title={q ? "Nothing out matches that" : "No books are out"}
            hint={q ? "Try a shorter word, or clear the search." : "Every book is back in the library."} />
        ) : (
          <LoansOutTable loans={shown} canReturn />
        )}
      </Card>

      {dues.length > 0 && (
        <Card>
          <CardHeader title="Fines to collect"
            action={<span className="text-[13px] tabular text-ink-500">{fmtMoney(dues.reduce((s, l) => s + l.fine, 0))}</span>} />
          <FinesDueTable loans={dues} />
        </Card>
      )}
    </div>
  );
}

async function OverdueView({ settings }: { settings: LibrarySettings }) {
  const open = await getOpenLoans(settings.fine_per_day);
  const overdue = open.filter((l) => l.days_late > 0).sort((a, b) => b.days_late - a.days_late);
  return (
    <Card>
      <CardHeader title="Overdue books" action={<OverdueDownload loans={overdue} />} />
      {overdue.length === 0 ? (
        <EmptyState art="all-done" title="Nothing is overdue" hint="Every book that is out is still within its due date." />
      ) : (
        <OverdueTable loans={overdue} />
      )}
    </Card>
  );
}

async function MineView({ member, settings }: { member: MemberRef; settings: LibrarySettings }) {
  const { current, history } = await getMemberLoans(member, settings.fine_per_day);
  return (
    <MyBooks current={current} history={history}
      limit={member.kind === "student" ? settings.max_books_student : settings.max_books_staff} />
  );
}
