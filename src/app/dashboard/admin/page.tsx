import Link from "next/link";
import { getSession, getCurrentYear } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { guardTab } from "@/lib/access";
import { cn, strParam } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { UpgradeRequest } from "@/components/admin/upgrade-request";
import { analyticsConfigured, hostDetail } from "@/lib/console/health";

// School admin: the office's and principal's view of their own school on
// CampusTwin: plan and modules, everything that changed and who signed in, and
// how their portal is running. Everything here is read with the signed-in
// user's own access, so it only ever shows this school (or, for a central
// admin, the campus they are working in).

type SP = Promise<Record<string, string | string[] | undefined>>;
type View = "overview" | "activity" | "access" | "health";
const BASE = "/dashboard/admin";
const MODULES: { key: string; label: string }[] = [
  { key: "fees", label: "Fees" }, { key: "library", label: "Library" }, { key: "homework", label: "Homework" },
  { key: "admissions", label: "Admissions" }, { key: "hr", label: "Staff HR and payroll" }, { key: "transport", label: "Transport" },
];
const tabCls = (on: boolean) => cn("rounded-sm border px-3.5 py-2 text-[14px] font-medium transition-colors",
  on ? "border-[#0F6CBD] bg-[#EBF3FC] font-semibold text-[#0F6CBD]" : "border-hair bg-surface text-ink-700 hover:border-[#B4D6FA] hover:bg-[#F5F9FE]");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "Never");
const ROLE: Record<string, string> = { staff: "Staff", guardian: "Parent", student: "Student" };
const th = "py-2 pr-3 text-left text-[12px] font-semibold text-ink-700";
const td = "py-2 pr-3 text-[14px] text-ink-900 align-top";
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export default async function SchoolAdminPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab(BASE);
  if (denied) return denied;
  const session = (await getSession())!;
  const sp = await searchParams;
  const views: { view: View; label: string }[] = [
    { view: "overview", label: "Plan and usage" }, { view: "activity", label: "Activity" },
    { view: "access", label: "Logins" }, { view: "health", label: "Health" },
  ];
  const view = (views.find((v) => v.view === strParam(sp.view))?.view ?? "overview") as View;
  const desc: Record<View, string> = {
    overview: "Your plan, what it includes and how much the school uses CampusTwin.",
    activity: "Every change made to the school's records, newest first.",
    access: "Who can sign in, and every sign-in.",
    health: "How your portal is running.",
  };
  return (
    <div>
      <PageHeader title="School admin" description={desc[view]} />
      <nav className="mb-5 flex flex-wrap gap-1.5 border-b border-hair pb-3" aria-label="School admin">
        {views.map((v) => (
          <Link prefetch={false} key={v.view} href={v.view === "overview" ? BASE : `${BASE}?view=${v.view}`} aria-current={v.view === view ? "page" : undefined} className={tabCls(v.view === view)}>{v.label}</Link>
        ))}
      </nav>
      {view === "overview" && <Overview schoolId={session.schoolId} />}
      {view === "activity" && <Activity who={strParam(sp.who) ?? undefined} what={strParam(sp.what) ?? undefined} />}
      {view === "access" && <Access />}
      {view === "health" && <Health slug={session.school.slug} />}
    </div>
  );
}

async function Overview({ schoolId }: { schoolId: number }) {
  const supabase = await createClient();
  const year = await getCurrentYear();
  const [{ data: me }, { data: catalog }, { data: requests }, students, staff, { data: logins }] = await Promise.all([
    supabase.from("school").select("plan, modules").eq("id", schoolId).single(),
    supabase.rpc("campustwin_plan_catalog" as never),
    supabase.from("plan_request" as never).select("requested_plan, status, created_at").order("created_at", { ascending: false }).limit(5),
    year ? supabase.from("student_enrollment").select("id", { count: "exact", head: true }).eq("academic_year_id", year.id).eq("status", "active") : Promise.resolve({ count: 0 }),
    supabase.from("staff").select("id", { count: "exact", head: true }),
    supabase.rpc("my_school_logins" as never),
  ]);
  const plans = (catalog ?? []) as { code: string; name: string; price_paise: number; modules: Record<string, boolean> }[];
  const mods = (me?.modules ?? {}) as Record<string, boolean>;
  const current = plans.find((p) => p.code === me?.plan);
  const pending = ((requests ?? []) as { requested_plan: string; status: string }[]).find((r) => r.status === "pending");
  const loginRows = (logins ?? []) as { role: string; last_sign_in_at: string | null }[];
  const active30 = loginRows.filter((l) => l.last_sign_in_at && Date.now() - Date.parse(l.last_sign_in_at) < 30 * 86_400_000).length;
  const stat = (label: string, value: number | string, sub?: string) => (
    <Card><CardBody><div className="text-[13px] text-ink-700">{label}</div><div className="mt-1 tabular text-[26px] font-semibold leading-none text-ink-900">{value}</div>{sub && <div className="mt-1.5 text-[12px] text-ink-500">{sub}</div>}</CardBody></Card>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat("Students this year", ((students as { count: number | null }).count ?? 0).toLocaleString("en-IN"))}
        {stat("Staff", ((staff as { count: number | null }).count ?? 0).toLocaleString("en-IN"))}
        {stat("Logins", loginRows.length.toLocaleString("en-IN"), `${active30} used in the last 30 days`)}
        {stat("Plan", current?.name ?? me?.plan ?? "—", current && current.price_paise ? `${rupees(current.price_paise)} per student a year` : undefined)}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="What each plan includes" />
          <CardBody className="overflow-x-auto pt-1">
            <table className="w-full min-w-[520px]">
              <thead><tr className="border-b border-hair"><th className={th}>Module</th>{plans.map((p) => <th key={p.code} className={cn(th, p.code === me?.plan && "text-[#0F6CBD]")}>{p.name}{p.code === me?.plan ? " (yours)" : ""}</th>)}<th className={th}>Your school</th></tr></thead>
              <tbody>
                {MODULES.map((m) => (
                  <tr key={m.key} className="border-b border-hair last:border-0">
                    <td className={td}>{m.label}</td>
                    {plans.map((p) => <td key={p.code} className={td}>{p.modules[m.key] ? "Included" : "—"}</td>)}
                    <td className={cn(td, "font-medium")}>{mods[m.key] ? "On" : "Off"}</td>
                  </tr>
                ))}
                <tr><td className={td}>Price</td>{plans.map((p) => <td key={p.code} className={td}>{p.price_paise ? `${rupees(p.price_paise)}/student/year` : "Ask us"}</td>)}<td className={td} /></tr>
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-ink-500">Attendance, marks, timetable, report cards, calendar and announcements are part of every plan.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change plan" />
          <CardBody className="pt-1">
            <UpgradeRequest plans={plans.map((p) => ({ code: p.code, name: p.name }))} current={me?.plan ?? ""} pending={pending ? plans.find((p) => p.code === pending.requested_plan)?.name ?? pending.requested_plan : null} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

async function Activity({ who, what }: { who?: string; what?: string }) {
  const supabase = await createClient();
  let q = supabase.from("audit_log" as never).select("at, actor_name, action, entity, label, fields").order("at", { ascending: false }).limit(300);
  if (who) q = q.eq("actor_name", who);
  if (what) q = q.eq("entity", what);
  const [{ data }, { data: facets }] = await Promise.all([q, supabase.from("audit_log" as never).select("actor_name, entity").order("at", { ascending: false }).limit(2000)]);
  const rows = (data ?? []) as { at: string; actor_name: string; action: string; entity: string; label: string | null; fields: string[] }[];
  const fx = (facets ?? []) as { actor_name: string; entity: string }[];
  const people = [...new Set(fx.map((f) => f.actor_name))].sort();
  const kinds = [...new Set(fx.map((f) => f.entity))].sort();
  const words = (f: string) => f.replace(/_id$/, "").replace(/_/g, " ");
  return (
    <Card>
      <CardHeader title="Activity" action={
        <form className="flex flex-wrap gap-2" action={BASE}>
          <input type="hidden" name="view" value="activity" />
          <select name="who" defaultValue={who ?? ""} aria-label="Who" className="h-8 rounded-sm border border-hair bg-surface px-2 text-[13px]"><option value="">Everyone</option>{people.map((p) => <option key={p}>{p}</option>)}</select>
          <select name="what" defaultValue={what ?? ""} aria-label="What" className="h-8 rounded-sm border border-hair bg-surface px-2 text-[13px]"><option value="">Everything</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select>
          <button className="h-8 rounded-sm border border-hair bg-surface px-3 text-[13px] font-medium">Show</button>
        </form>
      } />
      <CardBody className="pt-1">
        {rows.length === 0 ? <EmptyState title="Nothing yet" hint="Changes made from now on appear here." /> : (
          <ul className="divide-y divide-hair">
            {rows.map((r, i) => (
              <li key={i} className="py-2">
                <div className="text-[14px] text-ink-900"><span className="font-medium">{r.actor_name}</span> {r.action} {r.entity.toLowerCase()}{r.label ? <> <span className="font-medium">{r.label}</span></> : null}</div>
                <div className="text-[12px] text-ink-500">{when(r.at)}{r.fields.length ? ` · ${r.fields.slice(0, 6).map(words).join(", ")}${r.fields.length > 6 ? ` and ${r.fields.length - 6} more` : ""}` : ""}</div>
              </li>
            ))}
          </ul>
        )}
        {rows.length === 300 && <p className="mt-2 text-[12px] text-ink-500">Showing the latest 300. Use the filters to find older changes.</p>}
      </CardBody>
    </Card>
  );
}

async function Access() {
  const supabase = await createClient();
  const [{ data: logins }, { data: signIns }] = await Promise.all([
    supabase.rpc("my_school_logins" as never),
    supabase.rpc("my_school_sign_ins" as never, { p_limit: 300 } as never),
  ]);
  const people = (logins ?? []) as { full_name: string; role: string; email: string | null; created_at: string; last_sign_in_at: string | null }[];
  const events = (signIns ?? []) as { at: string; full_name: string; role: string; email: string | null }[];
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader title={`Logins (${people.length})`} action={<Link href="/dashboard/manage/access" className="text-[13px] font-medium text-[#0F6CBD] hover:underline">Give or remove access</Link>} />
        <CardBody className="overflow-x-auto pt-1">
          <table className="w-full min-w-[480px]">
            <thead><tr className="border-b border-hair"><th className={th}>Person</th><th className={th}>Signs in as</th><th className={th}>Last signed in</th></tr></thead>
            <tbody>{people.map((p, i) => (
              <tr key={i} className="border-b border-hair last:border-0"><td className={td}><div className="font-medium">{p.full_name}</div><div className="text-[12px] text-ink-500">{p.email ?? ""}</div></td><td className={td}>{ROLE[p.role] ?? p.role}</td><td className={td}>{when(p.last_sign_in_at)}</td></tr>
            ))}</tbody>
          </table>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sign-ins" />
        <CardBody className="pt-1">
          {events.length === 0 ? <EmptyState title="No sign-ins recorded yet" hint="Every sign-in from now on is listed here." /> : (
            <ul className="divide-y divide-hair">{events.map((e, i) => (
              <li key={i} className="flex justify-between gap-3 py-2 text-[14px]"><span><span className="font-medium text-ink-900">{e.full_name}</span> <span className="text-ink-500">({ROLE[e.role] ?? e.role})</span></span><span className="shrink-0 text-ink-700">{when(e.at)}</span></li>
            ))}</ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

async function Health({ slug }: { slug: string }) {
  const supabase = await createClient();
  const t0 = Date.now();
  const { error } = await supabase.from("class").select("id", { count: "exact", head: true });
  const dbMs = Date.now() - t0;
  const host = `${slug}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}`;
  const d = analyticsConfigured() ? await hostDetail(host, "24h").catch(() => null) : null;
  const errPct = d && d.requests ? (d.errors / d.requests) * 100 : 0;
  const ok = !error && errPct < 1;
  const stat = (label: string, value: string, sub?: string) => (
    <Card><CardBody><div className="text-[13px] text-ink-700">{label}</div><div className="mt-1 tabular text-[24px] font-semibold leading-none text-ink-900">{value}</div>{sub && <div className="mt-1.5 text-[12px] text-ink-500">{sub}</div>}</CardBody></Card>
  );
  return (
    <div className="space-y-5">
      <Card><CardBody className="flex items-center gap-3">
        <span className={cn("h-2.5 w-2.5 rounded-full", ok ? "bg-up" : "bg-down")} />
        <span className="text-[15px] font-medium text-ink-900">{ok ? "Your portal is running normally" : error ? "Your school's data is not responding" : "Some pages are failing"}</span>
        <span className="text-[13px] text-ink-500">{host}</span>
      </CardBody></Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat("Data response", error ? "Not responding" : `${dbMs} ms`, "Measured just now")}
        {d ? stat("Visits, last 24 hours", d.visits.toLocaleString("en-IN")) : null}
        {d ? stat("Pages served, last 24 hours", d.requests.toLocaleString("en-IN")) : null}
        {d ? stat("Server errors, last 24 hours", d.errors.toLocaleString("en-IN"), d.requests ? `${errPct.toFixed(2)}% of pages` : undefined) : null}
      </div>
      {d && d.failing.length > 0 && (
        <Card><CardHeader title="Pages that failed in the last 24 hours" /><CardBody className="pt-1">
          <ul className="divide-y divide-hair">{d.failing.slice(0, 10).map((f) => <li key={f.key} className="flex justify-between py-1.5 text-[13px]"><span className="font-mono text-ink-900">{f.key}</span><span className="text-ink-700">{f.count}</span></li>)}</ul>
        </CardBody></Card>
      )}
      {d && d.devices.length > 0 && (
        <Card><CardHeader title="How people open the portal" /><CardBody className="pt-1 text-[14px] text-ink-900">
          {d.devices.map((x) => `${x.key === "desktop" ? "Computer" : x.key === "mobile" ? "Phone" : x.key === "tablet" ? "Tablet" : "Other"} ${Math.round((x.count / Math.max(1, d.requests)) * 100)}%`).join(" · ")}
        </CardBody></Card>
      )}
      {!d && <p className="text-[13px] text-ink-500">Traffic figures appear here once portal analytics are connected for your school.</p>}
    </div>
  );
}
