import Link from "next/link";
import { analyticsConfigured, platformTraffic, databasePing, busyDays, evaluate, type Alert, type Traffic, type HostRow } from "@/lib/console/health";
import { institutionRows } from "@/lib/console/institutions";
import { ZoneHeader, Kpi, kpiStrip, ConsoleTable, type Col } from "@/components/console/table";
import { Section } from "@/components/console/ui";
import { HourlyLine } from "@/components/console/charts";
import { Icon } from "@/components/console/icons";

export const dynamic = "force-dynamic";
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const n = (v: number) => v.toLocaleString("en-IN");
const ms = (v: number | null | undefined) => (v == null ? "No data" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function Banner({ alerts, configured }: { alerts: Alert[]; configured: boolean }) {
  const worst = alerts.some((a) => a.level === "outage") ? "outage" : alerts.some((a) => a.level === "degraded") ? "degraded" : "ok";
  const tone = { outage: "border-cx-bad/40 bg-cx-bad/[0.06]", degraded: "border-cx-warn/40 bg-cx-warn/[0.07]", ok: "border-cx-line bg-cx-card" }[worst];
  const dot = { outage: "bg-cx-bad", degraded: "bg-cx-warn", ok: "bg-cx-ok" }[worst];
  const title = { outage: "Outage: users are affected right now", degraded: "Degraded: the platform is up but struggling", ok: "All systems normal" }[worst];
  const sub = worst === "ok"
    ? configured ? "Error rate, response times and the database are all within normal range." : "The database is responding. Connect traffic analytics to watch requests, errors and response times."
    : `${alerts.filter((a) => a.level !== "notice").length} issue${alerts.filter((a) => a.level !== "notice").length === 1 ? "" : "s"} need attention, see Alerts below.`;
  return (
    <div className={`mb-4 flex items-center gap-4 rounded-[10px] border px-5 py-4 ${tone}`}>
      <span className="relative flex h-3 w-3 shrink-0"><span className={`absolute inset-0 rounded-full ${dot}`} /></span>
      <div className="min-w-0">
        <p className="text-[17px] font-semibold leading-6 text-cx-text">{title}</p>
        <p className="text-[13px] text-cx-text-2">{sub}</p>
      </div>
    </div>
  );
}

export default async function HealthPage() {
  const configured = analyticsConfigured();
  const [traffic, db, rows] = await Promise.all([
    configured ? platformTraffic().catch((e: Error) => ({ error: e.message })) : Promise.resolve(null),
    databasePing(),
    institutionRows(),
  ]);
  const t: Traffic | null = traffic && !("error" in traffic) ? traffic : null;
  const trafficError = traffic && "error" in traffic ? traffic.error : null;
  const tenants = rows.filter((r) => r.kind !== "university");
  const days = await busyDays(new Map(tenants.map((r) => [r.id, r.students])), new Map(tenants.map((r) => [r.id, r.name])));
  const alerts = evaluate(t, db);
  if (trafficError) alerts.unshift({ level: "notice", title: "Traffic analytics unavailable", detail: trafficError });

  const req24 = t ? t.hours.reduce((s, h) => s + h.requests, 0) : 0;
  const err24 = t ? t.hours.reduce((s, h) => s + h.errors, 0) : 0;
  const latest = t ? [...t.hours].reverse().find((h) => h.p50 != null) : undefined;

  const nameOfHost = new Map<string, string>([[`console.${BASE}`, "Console"]]);
  for (const r of rows) nameOfHost.set(r.url, r.name);
  const hostCols: Col<HostRow>[] = [
    { key: "h", label: "Address", render: (h) => {
      const sub = h.host.endsWith(`.${BASE}`) ? h.host.slice(0, -(BASE.length + 1)) : null;
      const label = nameOfHost.get(h.host) ?? "Not an institution";
      return <div>{sub && /^[a-z0-9-]+$/.test(sub) ? <Link href={`/console/health/${sub}`} className="font-medium text-cx-link hover:underline">{label}</Link> : <span className="font-medium text-cx-text">{label}</span>}<div className="font-mono text-[12px] text-cx-muted">{h.host}</div></div>;
    } },
    { key: "r", label: "Requests", align: "right", render: (h) => n(h.requests) },
    { key: "e", label: "Server errors", align: "right", render: (h) => <span className={h.errors ? "font-medium text-cx-bad" : ""}>{n(h.errors)}</span> },
    { key: "p", label: "Error rate", align: "right", render: (h) => `${((100 * h.errors) / Math.max(1, h.requests)).toFixed(2)}%` },
  ];

  const ALERT_TONE = { outage: "text-cx-bad", degraded: "text-cx-warn", notice: "text-cx-muted" };
  const hasLatency = !!t && t.hours.some((h) => h.p99 != null);
  const alertsCard = (
    <Section title="Alerts" desc={alerts.length ? `${alerts.length} open` : "Nothing needs attention"} flush>
      {alerts.length ? (
        <ul className="divide-y divide-cx-line">
          {alerts.map((a, i) => (
            <li key={i} className="flex gap-3 px-5 py-3">
              <Icon name="alert" size={18} className={`mt-0.5 shrink-0 ${ALERT_TONE[a.level]}`} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-cx-text">{a.title}</p>
                <p className="text-[12.5px] leading-5 text-cx-muted">{a.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="px-5 py-8 text-center text-[13px] text-cx-muted">No errors, slowdowns or surges in the last 24 hours</p>}
    </Section>
  );
  const busyCard = (
    <Section title="Busy days ahead" desc="Exam starts across all institutions, next 45 days" flush>
      {days.length ? (
        <ul className="divide-y divide-cx-line">
          {days.map((d) => (
            <li key={d.date} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold text-cx-text">{day(d.date)}</span>
                <span className="text-[12.5px] tabular-nums text-cx-muted">{n(d.students)} students</span>
              </div>
              <p className="mt-0.5 text-[12.5px] leading-5 text-cx-text-2">
                {d.institutions.length} institution{d.institutions.length === 1 ? "" : "s"}: {d.institutions.join(", ")}
              </p>
            </li>
          ))}
        </ul>
      ) : <p className="px-5 py-8 text-center text-[13px] text-cx-muted">No exams scheduled in the next 45 days</p>}
    </Section>
  );
  const dbKpi = <Kpi label="Database" value={db.ok ? `${db.ms} ms` : "Not responding"} sub="round trip, measured now" />;

  return (
    <div>
      <ZoneHeader title="Platform health" sub="Every institution portal and the console, last 24 hours">
        {t && <span className="text-[13px] text-cx-muted">Updated {new Date(t.fetchedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}</span>}
      </ZoneHeader>

      <Banner alerts={alerts} configured={configured && !!t} />

      {t ? (
        <>
          <div className={kpiStrip}>
            <Kpi label="Requests" value={n(req24)} sub="last 24 hours" />
            <Kpi label="Server errors" value={n(err24)} sub={`${((100 * err24) / Math.max(1, req24)).toFixed(2)}% of requests`} />
            {hasLatency && <Kpi label="Typical page" value={ms(latest?.p50)} sub="half of pages are faster" />}
            {hasLatency && <Kpi label="Slowest 1%" value={ms(latest?.p99)} sub="latest hour" />}
            {dbKpi}
          </div>

          <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <Section title="Requests per hour" desc="Pages and data requests across all portals" flush>
                <div className="px-3 pb-3 pt-4"><HourlyLine data={t.hours.map((h) => ({ hour: h.hour, value: h.requests }))} label="requests" /></div>
              </Section>
            </div>
            {alertsCard}
          </div>

          <div className={`mb-4 grid items-start gap-4 ${hasLatency ? "xl:grid-cols-2" : ""}`}>
            {hasLatency && (
              <Section title="Slowest 1% of pages" desc="The first number to rise when the platform is under strain" flush>
                <div className="px-3 pb-3 pt-4"><HourlyLine data={t.hours.map((h) => ({ hour: h.hour, value: h.p99 }))} unit="ms" label="for the slowest 1%" height={200} /></div>
              </Section>
            )}
            <Section title="Server errors per hour" desc="Requests that failed on our side" flush>
              <div className="px-3 pb-3 pt-4"><HourlyLine data={t.hours.map((h) => ({ hour: h.hour, value: h.errors }))} label="errors" height={200} /></div>
            </Section>
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <Section title="Traffic by address" desc="Which portal the load and the errors come from. Open one for its full breakdown" flush>
                <ConsoleTable bare columns={hostCols} rows={t.hosts.slice(0, 15)} rowKey={(h) => h.host} empty="No traffic recorded" />
              </Section>
            </div>
            {busyCard}
          </div>
        </>
      ) : (
        <>
          <div className={kpiStrip}>
            {dbKpi}
            <Kpi label="Next exam rush" value={days[0] ? day(days[0].date) : "None scheduled"} sub={days[0] ? `${n(days[0].students)} students in ${days[0].institutions.length} institutions` : "next 45 days"} />
            <Kpi label="Portals watched" value={tenants.length + 1} sub="institutions and the console" />
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {alertsCard}
            {busyCard}
          </div>
        </>
      )}
    </div>
  );
}
