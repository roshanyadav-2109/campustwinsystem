import Link from "next/link";
import { getSession, getCurrentYear } from "@/lib/session";
import { guardTab } from "@/lib/access";
import { numParam, strParam } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { getStaffScope } from "@/lib/data/scope";
import { getMyChildren } from "@/lib/data/analytics";
import {
  FeesNotReady, getConcessionTypes, getDues, getFeeLetters, getFeeHeads, getFeeOverview, getFeeStructure, getInstalments, getLateRule, getRecentPayments,
  getStudentBrief, getStudentConcessions, getStudentLedger, searchStudents,
} from "@/lib/data/fees";
import { ConcessionTypesManager, HeadOptions, InstalmentPlanner, InstalmentRaise, LateFeeCard, StudentConcessions } from "@/components/fees/fees-plan";
import { createClient } from "@/lib/supabase/server";
import { FeeHeadsManager, FeeStructureGrid, InvoiceActions, RaiseFeesForm } from "@/components/fees/fees-office";
import { FamilyFeeLetters, OfficeFeeLetters } from "@/components/fees/fees-letters";
import { DemandNoticesButton, DuesExcelButton, TuitionCertificateButton } from "@/components/fees/fees-downloads";
import { InvoiceTable, OverviewView, PaymentTable, SegLinks, Stat } from "@/components/fees/fees-views";
import { TD, TD_R, TH, TH_R, fmtDay, fmtMoney } from "@/components/fees/shared";
import type { Session } from "@/lib/session";

type SP = Record<string, string | string[] | undefined>;
const BASE = "/dashboard/fees";

const VIEWS = [
  { key: "overview", label: "Overview", officeOnly: false },
  { key: "setup", label: "Fee setup", officeOnly: true },
  { key: "raise", label: "Raise fees", officeOnly: true },
  { key: "collect", label: "Collect", officeOnly: true },
  { key: "dues", label: "Dues list", officeOnly: false },
  { key: "receipts", label: "Receipts", officeOnly: false },
  { key: "letters", label: "Fee letters", officeOnly: true },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

export default async function FeesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const denied = await guardTab(BASE);
  if (denied) return denied;
  const sp = await searchParams;
  const session = (await getSession())!;

  try {
    if (session.role === "student" || session.role === "guardian") return await ownerScreen(session, sp);
    if (session.isAdminScope) return await adminScreen(session, sp);
  } catch (e) {
    if (!(e instanceof FeesNotReady)) throw e;
    return (
      <div>
        <PageHeader title="Fees" />
        <EmptyState art="maintenance" title="Fees are being set up" hint="This page will be ready shortly. Please check again later." />
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Fees" />
      <EmptyState art="no-access" title="Fees are handled by the school office" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student / guardian
// ---------------------------------------------------------------------------
async function ownerScreen(session: Session, sp: SP) {
  const year = await getCurrentYear();
  let studentId = session.studentId;
  let children: { id: number; full_name: string; admission_no: string }[] = [];
  if (session.role === "guardian") {
    children = await getMyChildren();
    const asked = numParam(sp.child);
    studentId = children.find((c) => c.id === asked)?.id ?? children[0]?.id ?? null;
  }
  const student = studentId && year ? await getStudentBrief(studentId, year.id) : null;
  if (!student) return (<div><PageHeader title="Fees" /><EmptyState title="Nothing to show yet" /></div>);

  const [{ invoices, payments }, letters] = await Promise.all([
    getStudentLedger(student, { includeCancelled: false }),
    getFeeLetters({ studentId: student.id, limit: 20 }),
  ]);
  const totalDue = invoices.reduce((n, i) => n + i.balance, 0);
  const overdue = invoices.filter((i) => i.overdue);
  const nextDue = invoices.filter((i) => i.balance > 0).map((i) => i.dueDate).sort()[0];
  const totalPaid = invoices.reduce((n, i) => n + i.paid, 0);

  return (
    <div>
      <PageHeader title="Fees" description={[student.name, student.classLabel].filter(Boolean).join(", ")} />
      {session.role === "guardian" && children.length > 1 && (
        <SegLinks label="Choose a child"
          items={children.map((c) => ({ href: `${BASE}?child=${c.id}`, label: c.full_name, active: c.id === student.id }))} />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total due" value={fmtMoney(totalDue)}
          note={totalDue > 0 ? (nextDue ? `Earliest due date ${fmtDay(nextDue)}` : undefined) : "Nothing to pay right now"} />
        <Stat label="Overdue" value={fmtMoney(overdue.reduce((n, i) => n + i.balance, 0))}
          note={overdue.length ? `${overdue.length} ${overdue.length === 1 ? "invoice is" : "invoices are"} past the due date` : "Nothing is past its due date"} />
        <Stat label="Paid so far" value={fmtMoney(totalPaid)} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-hair bg-panel px-3 py-2">
        <p className="text-[13px] text-ink-700">Pay at the school office or by bank transfer. Your receipt appears here once the office records it.</p>
        <TuitionCertificateButton studentId={student.id} />
      </div>
      <div className="mt-5 space-y-5">
        <Card>
          <CardHeader title="Invoices" />
          <CardBody><InvoiceTable invoices={invoices} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Payment history" />
          <CardBody><PaymentTable payments={payments} empty="No payments have been recorded yet." /></CardBody>
        </Card>
        <FamilyFeeLetters studentId={student.id} letters={letters} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Office (full) / principal (read-only)
// ---------------------------------------------------------------------------
async function adminScreen(session: Session, sp: SP) {
  const isOffice = session.staffRole === "office";
  const views = VIEWS.filter((v) => isOffice || !v.officeOnly);
  const asked = strParam(sp.view);
  const view: ViewKey = views.find((v) => v.key === asked)?.key ?? "overview";

  const [year, scope] = await Promise.all([getCurrentYear(), getStaffScope()]);
  const waitingLetters = isOffice ? (await getFeeLetters({ limit: 200 })).filter((l) => l.status === "pending").length : 0;
  const tabs = <SegLinks label="Fees sections" items={views.map((v) => ({ href: `${BASE}?view=${v.key}`, label: v.key === "letters" && waitingLetters ? `${v.label} (${waitingLetters})` : v.label, active: v.key === view }))} />;
  const frame = (body: React.ReactNode, actions?: React.ReactNode) => (
    <div>
      <PageHeader title="Fees" description={isOffice ? undefined : "View only. Fee records are kept by the school office."} actions={actions} />
      {tabs}
      {body}
    </div>
  );
  if (!year) return frame(<EmptyState title="No academic year is set as current" />);

  if (view === "overview") {
    return frame(<OverviewView data={await getFeeOverview(year.id, scope.sections)} yearName={year.name} />);
  }

  if (view === "setup") {
    const supabase = await createClient();
    const [heads, structure, instalments, types, lateRule, { data: yr }] = await Promise.all([
      getFeeHeads(), getFeeStructure(year.id), getInstalments(year.id), getConcessionTypes(), getLateRule(),
      supabase.from("academic_year").select("start_date").eq("id", year.id).single(),
    ]);
    return frame(
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <div className="self-start"><FeeHeadsManager heads={heads} /></div>
          <FeeStructureGrid classes={scope.classes} heads={heads.filter((h) => h.is_active)} structure={structure} yearName={year.name} />
        </div>
        <InstalmentPlanner instalments={instalments} yearStart={yr?.start_date ?? `${new Date().getFullYear()}-04-01`} yearName={year.name} />
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <HeadOptions heads={heads.filter((h) => h.is_active)} />
          <ConcessionTypesManager types={types} heads={heads} />
        </div>
        <LateFeeCard rule={lateRule} />
      </div>,
    );
  }

  if (view === "raise") {
    const [heads, structure] = await Promise.all([getFeeHeads(), getFeeStructure(year.id)]);
    const active = new Set(heads.filter((h) => h.is_active).map((h) => h.id));
    const classTotals: Record<number, number> = {};
    for (const r of structure) if (active.has(r.fee_head_id)) classTotals[r.class_id] = (classTotals[r.class_id] ?? 0) + r.amount;
    const supabase = await createClient();
    const [instalments, { count: enrolled }] = await Promise.all([
      getInstalments(year.id),
      supabase.from("student_enrollment").select("id", { count: "exact", head: true }).eq("academic_year_id", year.id).neq("status", "transferred"),
    ]);
    const sections = scope.sections.map((s) => ({ id: s.id, name: s.name, class_id: s.class_id }));
    return frame(
      <div className="space-y-5">
        <InstalmentRaise instalments={instalments} classes={scope.classes} sections={sections} enrolled={enrolled ?? 0} />
        <RaiseFeesForm classes={scope.classes} classTotals={classTotals} sections={sections} />
      </div>,
    );
  }

  if (view === "collect") {
    const q = (strParam(sp.q) ?? "").slice(0, 60);
    const studentId = numParam(sp.student);
    const [matches, student] = await Promise.all([
      q && !studentId ? searchStudents(q, year.id) : Promise.resolve([]),
      studentId ? getStudentBrief(studentId, year.id) : Promise.resolve(null),
    ]);
    const [ledger, granted, types] = student
      ? await Promise.all([getStudentLedger(student, { includeCancelled: true }), getStudentConcessions(student.id, year.id), getConcessionTypes()])
      : [null, [], []];
    const due = ledger ? ledger.invoices.reduce((n, i) => n + i.balance, 0) : 0;
    return frame(
      <div className="space-y-5">
        <Card>
          <CardBody>
            <form method="get" action={BASE} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="view" value="collect" />
              <div className="min-w-0 flex-1 sm:max-w-md">
                <Field label="Find a student" htmlFor="fee-q">
                  <Input id="fee-q" name="q" type="search" defaultValue={q} maxLength={60} placeholder="Name or admission number" />
                </Field>
              </div>
              <Button type="submit">Search</Button>
            </form>
            {q && !studentId && (
              matches.length === 0 ? (
                <p className="mt-3 text-[13px] text-ink-500">No student matches that. Type at least two letters of the name, or the admission number.</p>
              ) : (
                <ul className="mt-3">
                  {matches.map((m) => (
                    <li key={m.id} className="border-t border-hair">
                      <Link prefetch={false} href={`${BASE}?view=collect&student=${m.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 hover:bg-[#F5F9FE]">
                        <span className="font-medium text-[#0F6CBD]">{m.name}</span>
                        <span className="text-[13px] tabular text-ink-500">{[m.classLabel, m.admissionNo].filter(Boolean).join(" · ")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            )}
            {studentId && !student && <p className="mt-3 text-[13px] text-ink-500">That student could not be found.</p>}
          </CardBody>
        </Card>
        {student && ledger && (
          <>
            <Card>
              <CardHeader eyebrow={student.name} title={[student.classLabel, student.admissionNo].filter(Boolean).join(" · ")}
                action={<span className="flex flex-wrap items-center gap-3"><TuitionCertificateButton studentId={student.id} /><span className="text-[13px] text-ink-700">Total due <span className="font-semibold tabular text-ink-900">{fmtMoney(due)}</span></span></span>} />
              <CardBody>
                <InvoiceTable invoices={ledger.invoices} action={(inv) => <InvoiceActions key={inv.id} invoice={inv} />} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Payment history" />
              <CardBody><PaymentTable payments={ledger.payments} empty="No payments have been recorded for this student." /></CardBody>
            </Card>
            <StudentConcessions studentId={student.id} granted={granted} types={types} />
          </>
        )}
      </div>,
    );
  }

  if (view === "dues") {
    const sectionId = scope.sections.find((s) => s.id === numParam(sp.section))?.id ?? null;
    const classId = sectionId ? null : scope.classes.find((c) => c.id === numParam(sp.class))?.id ?? null;
    const ids = sectionId ? [sectionId] : classId ? scope.sections.filter((s) => s.class_id === classId).map((s) => s.id) : null;
    const overBy = [30, 60, 90].includes(numParam(sp.over) ?? 0) ? numParam(sp.over)! : 0;
    const rows = (await getDues(year.id, ids)).filter((r) => r.daysOverdue >= overBy && (overBy === 0 || r.overdue));
    const sec = scope.sections.find((s) => s.id === sectionId);
    const label = sec ? `${sec.class_name}-${sec.name}` : classId ? `Class ${scope.classes.find((c) => c.id === classId)?.name ?? ""}` : "Whole school";
    const total = rows.reduce((n, r) => n + r.pending, 0);
    return frame(
      <div className="space-y-5">
        <form method="get" action={BASE} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value="dues" />
          <div className="w-44">
            <Field label="Class" htmlFor="fee-class">
              <Select id="fee-class" name="class" defaultValue={classId ?? ""}>
                <option value="">All classes</option>
                {scope.classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Section" htmlFor="fee-section">
              <Select id="fee-section" name="section" defaultValue={sectionId ?? ""}>
                <option value="">All sections</option>
                {scope.sections.map((s) => (<option key={s.id} value={s.id}>{s.class_name}-{s.name}</option>))}
              </Select>
            </Field>
          </div>
          <div className="w-48">
            <Field label="Overdue" htmlFor="fee-over">
              <Select id="fee-over" name="over" defaultValue={overBy || ""}>
                <option value="">Everyone with dues</option>
                <option value="30">More than 30 days</option>
                <option value="60">More than 60 days</option>
                <option value="90">More than 90 days</option>
              </Select>
            </Field>
          </div>
          <Button type="submit" variant="subtle">Show</Button>
        </form>
        <Card>
          <CardHeader eyebrow="Dues" title={`${label}, ${rows.length} ${rows.length === 1 ? "student" : "students"}, ${fmtMoney(total)} pending`}
            action={<span className="flex flex-wrap gap-2"><DemandNoticesButton rows={rows} label={`${label} ${year.name}`} /><DuesExcelButton rows={rows} label={`${label} ${year.name}`} /></span>} />
          <CardBody>
            {rows.length === 0 ? (
              <p className="text-[13px] text-ink-500">No one has fees pending here.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead><tr>
                    <th className={TH}>Student</th><th className={TH}>Admission no.</th><th className={TH}>Class</th>
                    <th className={TH_R}>Open invoices</th><th className={TH_R}>Pending</th><th className={`${TH} pl-4`}>Oldest due date</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.studentId} className="border-t border-hair">
                        <td className={TD}>
                          {isOffice
                            ? <Link prefetch={false} href={`${BASE}?view=collect&student=${r.studentId}`} className="font-medium text-[#0F6CBD] hover:underline">{r.name}</Link>
                            : <span className="font-medium text-ink-900">{r.name}</span>}
                        </td>
                        <td className={`${TD} tabular`}>{r.admissionNo}</td>
                        <td className={`${TD} tabular`}>{r.classLabel}</td>
                        <td className={TD_R}>{r.invoices}</td>
                        <td className={`${TD_R} font-semibold`}>{fmtMoney(r.pending)}</td>
                        <td className={`${TD} pl-4 whitespace-nowrap tabular`}>
                          {fmtDay(r.oldestDue)}{r.overdue && <span className="ml-2 text-[12px] font-semibold text-down">{r.daysOverdue} {r.daysOverdue === 1 ? "day" : "days"} overdue</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>,
    );
  }

  if (view === "letters") return frame(<OfficeFeeLetters letters={await getFeeLetters({ limit: 200 })} />);

  // Receipts
  const payments = await getRecentPayments(200);
  return frame(
    <Card>
      <CardHeader eyebrow="Receipts" title="Latest 200 payments and refunds" />
      <CardBody>
        <PaymentTable payments={payments} showStudent empty="No payments have been recorded yet."
          studentHref={isOffice ? (id) => `${BASE}?view=collect&student=${id}` : undefined} />
      </CardBody>
    </Card>,
  );
}
