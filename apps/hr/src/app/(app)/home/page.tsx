import Link from "next/link";
import { getCtx } from "@/lib/context";
import { todayIST, fmtShort, fmtTime, fmtDays } from "@/lib/format";
import { PageHeader, Section, Kpi, kpiStrip, Empty, btnPrimary, btnGhost, linkCls } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { checkIn, checkOut } from "../actions";

export const metadata = { title: "Home" };

export default async function Home() {
  const { db, org, employeeId, isAdmin, isManager } = await getCtx();
  const today = todayIST();
  const year = Number(today.slice(0, 4));

  const [me, att, types, balances, pending, staff, presentToday, onLeave] = await Promise.all([
    employeeId ? db.from("employee").select("full_name").eq("id", employeeId).single() : Promise.resolve({ data: null }),
    employeeId ? db.from("attendance").select("check_in, check_out, status").eq("employee_id", employeeId).eq("day", today).maybeSingle() : Promise.resolve({ data: null }),
    db.from("leave_type").select("id, name, is_paid").eq("org_id", org.id).eq("active", true).order("name"),
    employeeId ? db.from("leave_balance").select("leave_type_id, balance").eq("employee_id", employeeId).eq("year", year) : Promise.resolve({ data: [] }),
    isAdmin || isManager ? db.from("leave_request").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "pending") : Promise.resolve({ count: 0 }),
    isAdmin || isManager ? db.from("employee").select("id", { count: "exact", head: true }).eq("org_id", org.id).neq("status", "left") : Promise.resolve({ count: 0 }),
    isAdmin || isManager ? db.from("attendance").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("day", today).in("status", ["present", "half_day"]) : Promise.resolve({ count: 0 }),
    isAdmin || isManager ? db.from("leave_request").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "approved").lte("from_date", today).gte("to_date", today) : Promise.resolve({ count: 0 }),
  ]);

  // First name, skipping titles such as Dr. or Mrs.
  const name = me.data?.full_name?.split(/\s+/).find((w) => !/^(dr|mr|mrs|ms|miss|prof|shri|smt|sri)\.?$/i.test(w));
  const a = att.data;
  const bal = new Map((balances.data ?? []).map((b) => [b.leave_type_id, Number(b.balance ?? 0)]));
  const paidTypes = (types.data ?? []).filter((t) => t.is_paid);
  const approver = isAdmin || isManager;

  return (
    <div>
      <PageHeader title={name ? `Hello, ${name}` : "Home"} sub={fmtShort(today)} />

      {approver && (
        <div className={kpiStrip}>
          <Kpi label="Employees" value={staff.count ?? 0} />
          <Kpi label="Checked in today" value={presentToday.count ?? 0} />
          <Kpi label="On leave today" value={onLeave.count ?? 0} />
          <Kpi label="Waiting for approval" value={pending.count ?? 0} sub={pending.count ? "leave requests" : undefined} />
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {employeeId ? (
          <Section title="Today">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-[14px] text-cx-text-2">
                {!a?.check_in && "You have not checked in yet."}
                {a?.check_in && !a.check_out && <>Checked in at <b className="font-semibold text-cx-text">{fmtTime(a.check_in)}</b></>}
                {a?.check_in && a.check_out && <>Checked in at <b className="font-semibold text-cx-text">{fmtTime(a.check_in)}</b>, out at <b className="font-semibold text-cx-text">{fmtTime(a.check_out)}</b></>}
              </div>
              {!a?.check_in && <ActionForm action={checkIn}><Submit className={btnPrimary} pending="Checking in">Check in</Submit></ActionForm>}
              {a?.check_in && !a.check_out && <ActionForm action={checkOut}><Submit className={btnGhost} pending="Checking out">Check out</Submit></ActionForm>}
            </div>
          </Section>
        ) : (
          <Section title="Your access">
            <p className="text-[14px] text-cx-text-2">You manage HR for {org.name}. You are not listed as an employee here, so attendance and personal leave are hidden. Add yourself under Employees with your sign-in email to use them.</p>
          </Section>
        )}

        {employeeId && (
          <Section title={`My leave balance, ${year}`} right={<Link href="/leave" className={linkCls}>Apply for leave</Link>} flush>
            {paidTypes.length ? (
              <ul className="divide-y divide-cx-line">
                {paidTypes.map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-5 py-2.5 text-[14px]">
                    <span className="text-cx-text">{t.name}</span>
                    <span className="tabular-nums text-cx-text-2">{fmtDays(bal.get(t.id) ?? 0)}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No leave types are set up yet.</Empty>}
          </Section>
        )}

        {isAdmin && <SetupChecklist />}
      </div>
    </div>
  );
}

async function SetupChecklist() {
  const { db, org } = await getCtx();
  const year = Number(todayIST().slice(0, 4));
  const [d, t, e, al] = await Promise.all([
    db.from("department").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    db.from("leave_type").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    db.from("employee").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    db.from("leave_ledger").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("kind", "allocation").eq("year", year),
  ]);
  const steps = [
    { done: (d.count ?? 0) > 0, label: "Add departments and designations", href: "/organisation" },
    { done: (t.count ?? 0) > 0, label: "Set up leave types", href: "/leave/policy" },
    { done: (e.count ?? 0) > 0, label: "Add employees", href: "/employees/new" },
    { done: (al.count ?? 0) > 0, label: `Give everyone their ${year} leave`, href: "/leave/policy" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <Section title="Set up HR" desc={`${steps.filter((s) => s.done).length} of ${steps.length} done`} flush>
      <ol className="divide-y divide-cx-line">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px]">
            <span className={s.done ? "text-cx-muted line-through" : "text-cx-text"}>{s.label}</span>
            {!s.done && <Link href={s.href} className={linkCls}>Start</Link>}
          </li>
        ))}
      </ol>
    </Section>
  );
}
