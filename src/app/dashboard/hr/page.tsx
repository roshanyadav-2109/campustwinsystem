import Link from "@/components/ui/hover-link";
import { getSession, getCurrentYear, type Session } from "@/lib/session";
import { guardTab } from "@/lib/access";
import { SCHOOL } from "@/lib/school";
import type { PdfDoc } from "@/lib/pdf";
import { cn, numParam, strParam } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/status";
import {
  getApprovedDays, getLeaveRequests, getLeaveTypes, getMyPayslips, getOnLeave, getPayrollRuns, getRunPayslips,
  getSalaries, getStaffLeave, getStaffList, monthBounds, schoolDate,
  type LeaveStatus, type LeaveType, type Payslip, type StaffRef,
} from "@/lib/data/hr";
import { ApplyLeaveForm, CancelLeaveButton, LeaveDecision } from "@/components/hr/leave-ui";
import { LeaveTypesEditor } from "@/components/hr/leave-types";
import { SalaryTable, type SalaryRow } from "@/components/hr/salary-ui";
import { PayrollBar, PayslipPdfButton, type RegisterExport } from "@/components/hr/payroll-ui";
import { fmtAmount, fmtDate, fmtDays, fmtMoney, fmtRange, LEAVE_STATUS_LABEL, monthLabel, roleLabel } from "@/components/hr/format";

type SP = Promise<Record<string, string | string[] | undefined>>;
type View = "my" | "payslips" | "requests" | "salary" | "payroll" | "types";

const TITLE = "Staff HR";
const BASE = "/dashboard/hr";

const tabCls = (on: boolean) =>
  cn("rounded-sm border px-3.5 py-2 text-[14px] font-medium transition-colors",
    on ? "border-[#0F6CBD] bg-[#EBF3FC] font-semibold text-[#0F6CBD]" : "border-hair bg-surface text-ink-700 hover:border-[#B4D6FA] hover:bg-[#F5F9FE]");
const chipCls = (on: boolean) =>
  cn("inline-flex h-8 items-center rounded-sm border px-3 text-[13px] font-medium transition-colors",
    on ? "border-[#0F6CBD] bg-[#EBF3FC] font-semibold text-[#0F6CBD]" : "border-hair bg-surface text-ink-700 hover:border-[#B4D6FA] hover:bg-[#F5F9FE]");

const STATUS_TONE: Record<LeaveStatus, Status> = { pending: "watch", approved: "up", rejected: "down", cancelled: "flat" };
const round2 = (x: number) => Math.round(x * 100) / 100;
const round1 = (x: number) => Math.round(x * 10) / 10;
const th = "py-2 pr-3 font-semibold";
const td = "py-2 pr-3 text-ink-900";

export default async function HrPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab(BASE);
  if (denied) return denied;
  const session = (await getSession())!;
  const sp = await searchParams;

  if (!session.staffId) {
    return (<div><PageHeader title={TITLE} /><EmptyState art="no-access" title="This page is for staff" /></div>);
  }
  const staffId = session.staffId;

  const [year, typeRes] = await Promise.all([getCurrentYear(), getLeaveTypes()]);
  if (typeRes.missing) {
    return (<div><PageHeader title={TITLE} /><EmptyState art="coming-soon" title="Staff HR isn't set up yet" hint="It will appear here once the school office has switched it on." /></div>);
  }
  if (!year) return (<div><PageHeader title={TITLE} /><EmptyState title="No school year is open yet" /></div>);
  const types = typeRes.types;

  const isAdmin = session.isAdminScope;
  const isOffice = session.staffRole === "office";
  const wanted = strParam(sp.view);
  const allowed: View[] = isAdmin ? ["my", "payslips", "requests", "salary", "payroll", "types"] : ["my", "payslips"];
  const view: View = allowed.includes(wanted as View) ? (wanted as View) : "my";

  const tabs: { view: View; label: string }[] = [
    { view: "my", label: "My leave" },
    { view: "payslips", label: "My payslips" },
    ...(isAdmin ? ([
      { view: "requests", label: "Leave requests" },
      { view: "salary", label: "Salary setup" },
      { view: "payroll", label: "Payroll" },
      { view: "types", label: "Leave types" },
    ] as { view: View; label: string }[]) : []),
  ];

  const description: Record<View, string> = {
    my: `Your leave for ${year.name}.`,
    payslips: "Your payslips for months the office has finalised.",
    requests: "Leave asked for by staff, and who is away today.",
    salary: isOffice ? "The monthly salary structure of every staff member." : "The monthly salary structure of every staff member. Only the office can change it.",
    payroll: isOffice ? "Prepare the month's payslips, check them, then finalise." : "The month's payslips as prepared by the office.",
    types: "The kinds of leave staff can take, and how many days a year each allows.",
  };

  return (
    <div>
      <PageHeader title={TITLE} description={description[view]} />
      <nav className="mb-5 flex flex-wrap gap-1.5 border-b border-hair pb-3" aria-label={TITLE}>
        {tabs.map((t) => (
          <Link prefetch={false} key={t.view} href={t.view === "my" ? BASE : `${BASE}?view=${t.view}`}
            aria-current={t.view === view ? "page" : undefined} className={tabCls(t.view === view)}>
            {t.label}
          </Link>
        ))}
      </nav>
      {view === "my" && <MyLeave staffId={staffId} yearId={year.id} types={types} />}
      {view === "payslips" && <MyPayslips session={session} staffId={staffId} slipId={numParam(sp.slip)} />}
      {view === "requests" && <Requests staffId={staffId} yearId={year.id} types={types} status={strParam(sp.status)} />}
      {view === "salary" && <SalarySetup canEdit={isOffice} />}
      {view === "payroll" && <Payroll canEdit={isOffice} month={strParam(sp.month)} />}
      {view === "types" && <LeaveTypesEditor canEdit={isOffice} types={types.map((t) => ({ id: t.id, code: t.code, name: t.name, daysPerYear: t.days_per_year, isPaid: t.is_paid, active: t.active }))} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My leave: balances, apply, history
// ---------------------------------------------------------------------------
async function MyLeave({ staffId, yearId, types }: { staffId: number; yearId: number; types: LeaveType[] }) {
  const leaves = await getStaffLeave(staffId, yearId);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const taken = new Map<number, number>();
  for (const l of leaves) if (l.status === "approved") taken.set(l.leave_type_id, (taken.get(l.leave_type_id) ?? 0) + l.days);
  const remaining = (t: LeaveType) => round1(Math.max(0, t.days_per_year - (taken.get(t.id) ?? 0)));

  return (
    <div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {types.filter((t) => t.active || taken.has(t.id)).map((t) => {
          const used = round1(taken.get(t.id) ?? 0);
          return (
            <Card key={t.id}>
              <CardBody>
                <div className="text-[13px] font-semibold text-ink-900">{t.name}</div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="tabular text-[26px] font-semibold leading-none text-ink-900">{t.is_paid ? remaining(t) : used}</span>
                  <span className="text-[13px] text-ink-500">{t.is_paid ? "left" : "taken"}</span>
                </div>
                <div className="mt-2 text-[13px] text-ink-700">
                  {t.is_paid
                    ? <>Allowed <span className="tabular">{t.days_per_year}</span>, taken <span className="tabular">{used}</span></>
                    : "Unpaid, no limit"}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="My leave history" />
          <CardBody>
            {leaves.length === 0 ? (
              <EmptyState title="No leave yet this year" hint="Requests you send appear here with their status." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[14px]">
                  <thead>
                    <tr className="border-b border-hair text-left text-[12px] text-ink-700">
                      <th className={th}>Dates</th>
                      <th className={th}>Type</th>
                      <th className={th}>Days</th>
                      <th className={th}>Status</th>
                      <th className="py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.map((l) => (
                      <tr key={l.id} className="border-b border-hair align-top last:border-0">
                        <td className={td}>
                          <div className="font-medium">{fmtRange(l.from_date, l.to_date)}</div>
                          <div className="text-[13px] text-ink-500">{l.reason}</div>
                          {l.decision_note && <div className="mt-0.5 text-[13px] text-ink-700">Note: {l.decision_note}</div>}
                        </td>
                        <td className={td}>{typeById.get(l.leave_type_id)?.name ?? "-"}</td>
                        <td className={cn(td, "tabular whitespace-nowrap")}>{fmtDays(l.days)}</td>
                        <td className={td}><StatusPill status={STATUS_TONE[l.status]}>{LEAVE_STATUS_LABEL[l.status]}</StatusPill></td>
                        <td className="py-2 text-right">{l.status === "pending" && <CancelLeaveButton id={l.id} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
        <div>
          <ApplyLeaveForm types={types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, code: t.code, isPaid: t.is_paid, remaining: remaining(t) }))} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My payslips
// ---------------------------------------------------------------------------
function payslipPdf(slip: Payslip, person: { name: string; role: string | null; code: string | null }): PdfDoc {
  const month = monthLabel(slip.month);
  const deductions = round2(slip.pf_deduction + slip.tax_deduction + slip.other_deduction + slip.lwp_deduction);
  return {
    filename: `Payslip ${person.name} ${month}`,
    title: `Payslip for ${month}`,
    meta: [person.name, "Amounts in rupees"],
    blocks: [
      {
        kind: "facts",
        items: [
          ["Name", person.name],
          ["Employee code", person.code ?? "-"],
          ["Role", roleLabel(person.role)],
          ["Month", month],
          ["Working days", String(slip.working_days)],
          ["Unpaid leave days", String(slip.unpaid_leave_days)],
        ],
      },
      {
        kind: "table", heading: "Earnings", headers: ["Item", "Amount"], right: [1],
        rows: [
          ["Basic pay", fmtAmount(slip.basic)],
          ["House rent allowance", fmtAmount(slip.hra)],
          ["Dearness allowance", fmtAmount(slip.da)],
          ["Other allowances", fmtAmount(slip.other_allowance)],
          ["Total earnings", fmtAmount(slip.gross)],
        ],
      },
      {
        kind: "table", heading: "Deductions", headers: ["Item", "Amount"], right: [1],
        rows: [
          ["Provident fund", fmtAmount(slip.pf_deduction)],
          ["Tax", fmtAmount(slip.tax_deduction)],
          ["Other deductions", fmtAmount(slip.other_deduction)],
          ["Leave without pay", fmtAmount(slip.lwp_deduction)],
          ["Total deductions", fmtAmount(deductions)],
        ],
      },
      { kind: "facts", heading: "Net pay", items: [["Net pay", `Rs ${fmtAmount(slip.net)}`]] },
      { kind: "text", lines: [`Issued by ${SCHOOL.fullName}. This is a computer-generated payslip and needs no signature.`] },
    ],
  };
}

function AmountList({ title, rows, total }: { title: string; rows: [string, number][]; total: [string, number] }) {
  return (
    <div>
      <h3 className="t-h3 text-ink-900">{title}</h3>
      <dl className="mt-2 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-hair py-1.5">
            <dt className="text-ink-700">{k}</dt><dd className="tabular text-ink-900">{fmtMoney(v)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 py-1.5 font-semibold text-ink-900">
          <dt>{total[0]}</dt><dd className="tabular">{fmtMoney(total[1])}</dd>
        </div>
      </dl>
    </div>
  );
}

async function MyPayslips({ session, staffId, slipId }: { session: Session; staffId: number; slipId: number | null }) {
  const [slips, staff] = await Promise.all([getMyPayslips(staffId, session.isAdminScope), getStaffList()]);
  if (!slips.length) {
    return <EmptyState title="No payslips yet" hint="A payslip appears here once the office finalises the month's payroll." />;
  }
  const me = staff.find((s) => s.id === staffId);
  const slip = slips.find((s) => s.id === slipId) ?? slips[0];
  const deductions = round2(slip.pf_deduction + slip.tax_deduction + slip.other_deduction + slip.lwp_deduction);
  const doc = payslipPdf(slip, { name: me?.full_name ?? session.fullName, role: me?.role ?? session.staffRole, code: me?.employee_code ?? null });

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <Card>
        <CardHeader title="Months" />
        <CardBody className="p-2">
          <ul>
            {slips.map((s) => (
              <li key={s.id}>
                <Link prefetch={false} href={`${BASE}?view=payslips&slip=${s.id}`} aria-current={s.id === slip.id ? "true" : undefined}
                  className={cn("flex items-center justify-between gap-3 rounded-sm px-3 py-2 text-[14px]",
                    s.id === slip.id ? "bg-[#EBF3FC] font-semibold text-[#0F6CBD]" : "text-ink-900 hover:bg-panel")}>
                  <span>{monthLabel(s.month)}</span>
                  <span className="tabular text-[13px]">{fmtMoney(s.net)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`Payslip for ${monthLabel(slip.month)}`} action={<PayslipPdfButton doc={doc} />} />
        <CardBody>
          <p className="text-[13px] text-ink-700">
            Working days <span className="tabular font-semibold text-ink-900">{slip.working_days}</span>, unpaid leave days{" "}
            <span className="tabular font-semibold text-ink-900">{slip.unpaid_leave_days}</span>
          </p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <AmountList title="Earnings"
              rows={[["Basic pay", slip.basic], ["House rent allowance", slip.hra], ["Dearness allowance", slip.da], ["Other allowances", slip.other_allowance]]}
              total={["Total earnings", slip.gross]} />
            <AmountList title="Deductions"
              rows={[["Provident fund", slip.pf_deduction], ["Tax", slip.tax_deduction], ["Other deductions", slip.other_deduction], ["Leave without pay", slip.lwp_deduction]]}
              total={["Total deductions", deductions]} />
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-3 rounded-sm border border-hair bg-panel px-4 py-3">
            <span className="text-[14px] font-semibold text-ink-900">Net pay</span>
            <span className="tabular text-[20px] font-semibold text-ink-900">{fmtMoney(slip.net)}</span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leave requests (principal and office)
// ---------------------------------------------------------------------------
const FILTERS: { key: LeaveStatus | "all"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

async function Requests({ staffId, yearId, types, status }: { staffId: number; yearId: number; types: LeaveType[]; status: string | null }) {
  const filter = FILTERS.find((f) => f.key === status)?.key ?? "pending";
  const today = schoolDate();
  const [requests, approved, staff, away] = await Promise.all([
    getLeaveRequests(yearId, filter), getApprovedDays(yearId), getStaffList(), getOnLeave(today),
  ]);
  const staffById = new Map<number, StaffRef>(staff.map((s) => [s.id, s]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const balanceLeft = (sid: number, t: LeaveType | undefined) =>
    !t ? "-" : !t.is_paid ? "No limit" : `${round1(Math.max(0, t.days_per_year - (approved.get(`${sid}:${t.id}`) ?? 0)))} of ${t.days_per_year}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link prefetch={false} key={f.key} href={`${BASE}?view=requests&status=${f.key}`} className={chipCls(f.key === filter)}>{f.label}</Link>
          ))}
        </div>
        {requests.length === 0 ? (
          <Card><EmptyState art={filter === "pending" ? "all-done" : "nothing-yet"}
            title={filter === "pending" ? "No requests are waiting" : "No requests to show"} /></Card>
        ) : (
          <div className="space-y-3">
            {requests.map((l) => {
              const person = staffById.get(l.staff_id);
              const type = typeById.get(l.leave_type_id);
              const decider = l.decided_by ? staffById.get(l.decided_by) : null;
              return (
                <Card key={l.id}>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-ink-900">{person?.full_name ?? "Staff member"}</div>
                        <div className="text-[13px] text-ink-500">{roleLabel(person?.role)}{person?.employee_code ? `, ${person.employee_code}` : ""}</div>
                      </div>
                      <StatusPill status={STATUS_TONE[l.status]}>{LEAVE_STATUS_LABEL[l.status]}</StatusPill>
                    </div>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-4">
                      <div><dt className="text-[12px] text-ink-500">Type</dt><dd className="text-ink-900">{type?.name ?? "-"}</dd></div>
                      <div><dt className="text-[12px] text-ink-500">Dates</dt><dd className="text-ink-900">{fmtRange(l.from_date, l.to_date)}</dd></div>
                      <div><dt className="text-[12px] text-ink-500">Days</dt><dd className="tabular text-ink-900">{fmtDays(l.days)}</dd></div>
                      <div><dt className="text-[12px] text-ink-500">Balance left</dt><dd className="tabular text-ink-900">{balanceLeft(l.staff_id, type)}</dd></div>
                    </dl>
                    <p className="mt-3 text-[14px] text-ink-900"><span className="text-ink-500">Reason: </span>{l.reason}</p>
                    {l.status === "pending" ? (
                      <div className="mt-3 border-t border-hair pt-3">
                        {l.staff_id === staffId
                          ? <p className="text-[13px] text-ink-500">This is your own request. Someone else must decide it.</p>
                          : <LeaveDecision id={l.id} />}
                      </div>
                    ) : (l.status === "approved" || l.status === "rejected") && (
                      <p className="mt-3 border-t border-hair pt-3 text-[13px] text-ink-700">
                        {LEAVE_STATUS_LABEL[l.status]}{decider ? ` by ${decider.full_name}` : ""}{l.decided_at ? ` on ${fmtDate(l.decided_at)}` : ""}
                        {l.decision_note ? `. Note: ${l.decision_note}` : ""}
                      </p>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <Card>
          <CardHeader title="On leave today" action={<span className="text-[13px] text-ink-500">{fmtDate(today)}</span>} />
          <CardBody>
            {away.length === 0 ? (
              <p className="text-[14px] text-ink-500">Nobody is on approved leave today.</p>
            ) : (
              <ul className="space-y-3">
                {away.map((l) => {
                  const person = staffById.get(l.staff_id);
                  return (
                    <li key={l.id}>
                      <div className="text-[14px] font-medium text-ink-900">{person?.full_name ?? "Staff member"}</div>
                      <div className="text-[13px] text-ink-500">
                        {roleLabel(person?.role)}, {typeById.get(l.leave_type_id)?.name ?? "Leave"}, {l.days === 0.5 ? "half day" : fmtRange(l.from_date, l.to_date)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Salary setup (office edits; principal reads)
// ---------------------------------------------------------------------------
async function SalarySetup({ canEdit }: { canEdit: boolean }) {
  const [staff, salaries] = await Promise.all([getStaffList(), getSalaries()]);
  const byStaff = new Map(salaries.map((s) => [s.staff_id, s]));
  const rows: SalaryRow[] = staff.map((p) => {
    const s = byStaff.get(p.id);
    return {
      staffId: p.id, name: p.full_name, role: p.role, code: p.employee_code,
      salary: s ? {
        basic: s.basic, hra: s.hra, da: s.da, otherAllowance: s.other_allowance,
        pfDeduction: s.pf_deduction, taxDeduction: s.tax_deduction, otherDeduction: s.other_deduction,
        bankName: s.bank_name, accountLast4: s.account_last4, effectiveFrom: s.effective_from,
      } : null,
    };
  });
  const set = rows.filter((r) => r.salary).length;
  return (
    <Card>
      <CardHeader title={`Staff (${rows.length})`} action={<span className="text-[13px] text-ink-500">{set} with a salary set up</span>} />
      <CardBody><SalaryTable rows={rows} canEdit={canEdit} today={schoolDate()} /></CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Payroll (office prepares and finalises; principal reads)
// ---------------------------------------------------------------------------
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <div className="text-[13px] text-ink-700">{label}</div>
        <div className="tabular mt-1 text-[22px] font-semibold text-ink-900">{value}</div>
      </CardBody>
    </Card>
  );
}

async function Payroll({ canEdit, month }: { canEdit: boolean; month: string | null }) {
  const thisMonth = schoolDate().slice(0, 7);
  const ym = month && monthBounds(month) && month <= thisMonth ? month : thisMonth;
  const monthStart = `${ym}-01`;

  const [runs, staff] = await Promise.all([getPayrollRuns(), getStaffList()]);
  const run = runs.find((r) => r.month === monthStart) ?? null;
  const slips = run ? await getRunPayslips(run.id) : [];
  const staffById = new Map<number, StaffRef>(staff.map((s) => [s.id, s]));
  const name = (s: Payslip) => staffById.get(s.staff_id)?.full_name ?? "Staff member";
  slips.sort((a, b) => name(a).localeCompare(name(b)));

  const dedOf = (s: Payslip) => round2(s.pf_deduction + s.tax_deduction + s.other_deduction + s.lwp_deduction);
  const totalGross = round2(slips.reduce((t, s) => t + s.gross, 0));
  const totalDed = round2(slips.reduce((t, s) => t + dedOf(s), 0));
  const totalNet = round2(slips.reduce((t, s) => t + s.net, 0));
  const sum = (pick: (s: Payslip) => number) => round2(slips.reduce((t, s) => t + pick(s), 0));

  const register: RegisterExport | undefined = slips.length ? {
    filename: `Payroll register ${monthLabel(ym)}${run?.status === "draft" ? " (draft)" : ""}`,
    sheetName: monthLabel(ym),
    headers: ["Employee code", "Name", "Role", "Working days", "Unpaid leave days", "Basic", "HRA", "DA", "Other allowances", "Gross",
      "Provident fund", "Tax", "Other deductions", "Leave without pay", "Total deductions", "Net pay"],
    rows: [
      ...slips.map((s) => {
        const p = staffById.get(s.staff_id);
        return [p?.employee_code ?? "", name(s), roleLabel(p?.role), s.working_days, s.unpaid_leave_days, s.basic, s.hra, s.da, s.other_allowance, s.gross,
          s.pf_deduction, s.tax_deduction, s.other_deduction, s.lwp_deduction, dedOf(s), s.net];
      }),
      ["", "Total", "", null, sum((s) => s.unpaid_leave_days), sum((s) => s.basic), sum((s) => s.hra), sum((s) => s.da), sum((s) => s.other_allowance), totalGross,
        sum((s) => s.pf_deduction), sum((s) => s.tax_deduction), sum((s) => s.other_deduction), sum((s) => s.lwp_deduction), totalDed, totalNet],
    ],
  } : undefined;

  const status = run ? run.status : "none";

  return (
    <div>
      <PayrollBar key={ym} month={ym} maxMonth={thisMonth} status={status} canEdit={canEdit} hasSlips={slips.length > 0} register={register} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[14px] text-ink-900">
        <span className="font-semibold">{monthLabel(ym)}</span>
        {run ? (
          <StatusPill status={run.status === "finalised" ? "up" : "watch"}>{run.status === "finalised" ? "Finalised" : "Draft"}</StatusPill>
        ) : <StatusPill status="flat">Not prepared</StatusPill>}
        {run?.status === "finalised" && run.finalised_at && <span className="text-[13px] text-ink-500">on {fmtDate(run.finalised_at)}. Staff can see their payslips.</span>}
        {run?.status === "draft" && <span className="text-[13px] text-ink-500">Staff cannot see draft payslips.</span>}
      </div>

      {slips.length === 0 ? (
        <Card>
          <EmptyState title={run ? "This draft has no payslips" : "Payroll has not been prepared for this month"}
            hint={canEdit
              ? "Press Prepare payroll to make one payslip for every staff member who has a salary set up."
              : "The office has not prepared this month yet."} />
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Stat label={`Gross pay, ${slips.length} staff`} value={fmtMoney(totalGross)} />
            <Stat label="Deductions" value={fmtMoney(totalDed)} />
            <Stat label="Net pay" value={fmtMoney(totalNet)} />
          </div>
          <Card>
            <CardHeader title="Payslips" />
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-[14px]">
                  <thead>
                    <tr className="border-b border-hair text-left text-[12px] text-ink-700">
                      <th className={th}>Name</th>
                      <th className={cn(th, "text-right")}>Unpaid days</th>
                      <th className={cn(th, "text-right")}>Basic</th>
                      <th className={cn(th, "text-right")}>HRA</th>
                      <th className={cn(th, "text-right")}>DA</th>
                      <th className={cn(th, "text-right")}>Other</th>
                      <th className={cn(th, "text-right")}>Gross</th>
                      <th className={cn(th, "text-right")}>PF, tax, other</th>
                      <th className={cn(th, "text-right")}>Unpaid leave</th>
                      <th className={cn(th, "text-right")}>Net pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slips.map((s) => {
                      const p = staffById.get(s.staff_id);
                      return (
                        <tr key={s.id} className="border-b border-hair">
                          <td className={td}>
                            <div className="font-medium">{name(s)}</div>
                            <div className="text-[12px] text-ink-500">{roleLabel(p?.role)}{p?.employee_code ? `, ${p.employee_code}` : ""}</div>
                          </td>
                          <td className={cn(td, "tabular text-right")}>{s.unpaid_leave_days}</td>
                          <td className={cn(td, "tabular text-right")}>{fmtMoney(s.basic)}</td>
                          <td className={cn(td, "tabular text-right")}>{fmtMoney(s.hra)}</td>
                          <td className={cn(td, "tabular text-right")}>{fmtMoney(s.da)}</td>
                          <td className={cn(td, "tabular text-right")}>{fmtMoney(s.other_allowance)}</td>
                          <td className={cn(td, "tabular text-right")}>{fmtMoney(s.gross)}</td>
                          <td className={cn(td, "tabular text-right")}>{fmtMoney(round2(s.pf_deduction + s.tax_deduction + s.other_deduction))}</td>
                          <td className={cn(td, "tabular text-right")}>{fmtMoney(s.lwp_deduction)}</td>
                          <td className={cn(td, "tabular text-right font-semibold")}>{fmtMoney(s.net)}</td>
                        </tr>
                      );
                    })}
                    <tr className="font-semibold text-ink-900">
                      <td className="py-2 pr-3">Total</td>
                      <td className="tabular py-2 pr-3 text-right">{sum((s) => s.unpaid_leave_days)}</td>
                      <td className="tabular py-2 pr-3 text-right">{fmtMoney(sum((s) => s.basic))}</td>
                      <td className="tabular py-2 pr-3 text-right">{fmtMoney(sum((s) => s.hra))}</td>
                      <td className="tabular py-2 pr-3 text-right">{fmtMoney(sum((s) => s.da))}</td>
                      <td className="tabular py-2 pr-3 text-right">{fmtMoney(sum((s) => s.other_allowance))}</td>
                      <td className="tabular py-2 pr-3 text-right">{fmtMoney(totalGross)}</td>
                      <td className="tabular py-2 pr-3 text-right">{fmtMoney(sum((s) => s.pf_deduction + s.tax_deduction + s.other_deduction))}</td>
                      <td className="tabular py-2 pr-3 text-right">{fmtMoney(sum((s) => s.lwp_deduction))}</td>
                      <td className="tabular py-2 pr-3 text-right">{fmtMoney(totalNet)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {runs.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-700">Prepared months</span>
          {runs.slice(0, 12).map((r) => (
            <Link prefetch={false} key={r.id} href={`${BASE}?view=payroll&month=${r.month.slice(0, 7)}`} className={chipCls(r.month === monthStart)}>
              {monthLabel(r.month)}{r.status === "draft" ? " (draft)" : ""}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
