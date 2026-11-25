import Link from "next/link";
import { analyticsConfigured, platformTraffic, databasePing, storagePing, busyDays, evaluate, parseRange, RANGES, type Alert, type Traffic, type HostRow, type Range } from "@/lib/console/health";
import { institutionRows } from "@/lib/console/institutions";
import { ZoneHeader, Kpi, kpiStrip, ConsoleTable, type Col } from "@/components/console/table";
import { Section } from "@/components/console/ui";
import { HourlyLine } from "@/components/console/charts";
import { Icon, type IconName } from "@/components/console/icons";
import { RangeTabs } from "@/components/console/range-tabs";

export const dynamic = "force-dynamic";
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const IST = "Asia/Kolkata";
const n = (v: number) => v.toLocaleString("en-IN");
const ms = (v: number | null | undefined) => (v == null ? "No data" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const when = (s: string, bucket: string) => bucket === "day"
  ? new Date(s + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
  : new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", ...(bucket === "hour" ? {} : { minute: "2-digit" }), hour12: true, timeZone: IST });
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
// "18 Nov to 25 Nov", or "24 Nov, 11 am to now" for the short windows.
function spanLabel(since: string, range: Range) {
  const d = new Date(since);
  if (range === "7d" || range === "30d") {
    const f = (x: Date) => x.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
    return `${f(d)} to ${f(new Date())}`;
  }
  return `${d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST })} to now`;
}

function Banner({ alerts, configured }: { alerts: Alert[]; configured: boolean }) {
  const worst = alerts.some((a) => a.level === "outage") ? "outage" : alerts.some((a) => a.level === "degraded") ? "degraded" : "ok";
  const tone = { outage: "border-cx-bad/40 bg-cx-bad/[0.06]", degraded: "border-cx-warn/40 bg-cx-warn/[0.07]", ok: "border-cx-line bg-cx-card" }[worst];
  const dot = { outage: "bg-cx-bad", degraded: "bg-cx-warn", ok: "bg-cx-ok" }[worst];
  const title = { outage: "Outage: users are affected right now", degraded: "Degraded: the platform is up but struggling", ok: "All systems normal" }[worst];
  const issues = alerts.filter((a) => a.level !== "notice").length;
  const sub = worst === "ok"
    ? configured ? "Error rate, response times and the database are all within normal range." : "The database is responding. Connect traffic analytics to watch requests, errors and response times."
    : `${issues} issue${issues === 1 ? "" : "s"} need attention, see Alerts below.`;
  return (
    <div className={`mb-4 flex items-center gap-4 rounded-[10px] border px-5 py-4 ${tone}`}>
      <span className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0">
        <p className="text-[17px] font-semibold leading-6 text-cx-text">{title}</p>
        <p className="text-[13px] text-cx-text-2">{sub}</p>
      </div>
    </div>
  );
}

// Card with a quiet header band, so a block of related facts reads as one unit.
function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-cx-line bg-cx-card">
      <header className="flex items-center justify-between gap-3 border-b border-cx-line bg-cx-raised px-5 py-2.5">
        <h2 className="text-[14px] font-medium text-cx-text-2">{title}</h2>
        {aside && <span className="text-[12.5px] text-cx-muted">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

// One sentence per fact, with the figure in bold: read once, understood once.
function Fact({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-2">
      <Icon name={icon} size={18} className="mt-px shrink-0 text-cx-muted" />
      <p className="text-[14px] leading-6 text-cx-text-2 [&_b]:font-semibold [&_b]:text-cx-text">{children}</p>
    </li>
  );
}

type Change = { pct: number; vs: string; goodWhenDown?: boolean } | null;
function Delta({ change }: { change: Change }) {
  if (!change || !Number.isFinite(change.pct)) return null;
  const up = change.pct >= 0;
  const flat = Math.abs(change.pct) < 0.5;
  const tone = flat || change.goodWhenDown === undefined ? "text-cx-text-2" : up === change.goodWhenDown ? "text-cx-bad" : "text-cx-ok";
  return (
    <p className={`mt-1 flex items-center gap-1 text-[12.5px] ${tone}`}>
      {!flat && <Icon name={up ? "arrow-up" : "arrow-down"} size={13} />}
      <span className="tabular-nums">{flat ? "No change" : `${Math.abs(change.pct).toFixed(1)}%`}</span>
      <span className="text-cx-muted">vs {change.vs}</span>
    </p>
  );
}

// Figure on the left, its shape over time on the right, like a hosting panel.
function TrendRow({ label, value, change, children }: { label: string; value: string; change: Change; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 px-5 py-4 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6">
      <div>
        <p className="text-[13px] text-cx-muted">{label}</p>
        <p className="mt-0.5 text-[26px] font-semibold leading-8 tabular-nums text-cx-text">{value}</p>
        <Delta change={change} />
      </div>
      <div className="-mx-2 md:mx-0">{children}</div>
    </div>
  );
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const R = RANGES[range];
  const configured = analyticsConfigured();
  // Alerts always judge the last 24 hours, whatever window the charts show.
  const [traffic, day24, db, rows, storage] = await Promise.all([
    configured ? platformTraffic(range).catch((e: Error) => ({ error: e.message })) : Promise.resolve(null),
    configured && range !== "24h" ? platformTraffic("24h").catch(() => null) : Promise.resolve(null),
    databasePing(),
    institutionRows(),
    storagePing(),
  ]);
  const t: Traffic | null = traffic && !("error" in traffic) ? traffic : null;
  const trafficError = traffic && "error" in traffic ? traffic.error : null;
  const tenants = rows.filter((r) => r.kind !== "university");
  const days = await busyDays(new Map(tenants.map((r) => [r.id, r.students])), new Map(tenants.map((r) => [r.id, r.name])));
  const alerts = evaluate(range === "24h" ? t : day24, db);
  if (!storage.ok) alerts.unshift({ level: "degraded", title: "File storage unavailable", detail: storage.reason ?? "Uploads will fail." });
  if (trafficError) alerts.unshift({ level: "notice", title: "Traffic analytics unavailable", detail: trafficError });

  const nameOfHost = new Map<string, string>([[`console.${BASE}`, "Console"]]);
  for (const r of rows) nameOfHost.set(r.url, r.name);
  const subOf = (host: string) => { const s = host.endsWith(`.${BASE}`) ? host.slice(0, -(BASE.length + 1)) : null; return s && /^[a-z0-9-]+$/.test(s) ? s : null; };
  const q = range === "24h" ? "" : `?range=${range}`;
  type Row = HostRow & { stray?: string[] };
  const hostCols: Col<Row>[] = [
    { key: "h", label: "Address", render: (h) => {
      if (h.stray) return (
        <div>
          <span className="font-medium text-cx-text">Unrecognised addresses</span>
          <div className="text-[12px] text-cx-muted">{h.stray.length} names that are not a portal, mostly automated scanners: <span className="font-mono">{h.stray.slice(0, 4).map((s) => s.split(".")[0]).join(", ")}{h.stray.length > 4 ? ", ..." : ""}</span></div>
        </div>
      );
      const sub = subOf(h.host);
      return <div>{sub ? <Link href={`/console/health/${sub}${q}`} className="font-medium text-cx-link hover:underline">{nameOfHost.get(h.host)}</Link> : <span className="font-medium text-cx-text">{nameOfHost.get(h.host)}</span>}<div className="font-mono text-[12px] text-cx-muted">{h.host}</div></div>;
    } },
    { key: "r", label: "Requests", align: "right", render: (h) => n(h.requests) },
    { key: "e", label: "Server errors", align: "right", render: (h) => <span className={h.errors ? "font-medium text-cx-bad" : ""}>{n(h.errors)}</span> },
    { key: "p", label: "Error rate", align: "right", render: (h) => `${((100 * h.errors) / Math.max(1, h.requests)).toFixed(2)}%` },
  ];

  const ALERT_TONE = { outage: "text-cx-bad", degraded: "text-cx-warn", notice: "text-cx-muted" };
  const alertsCard = (
    <Section title="Alerts" desc={alerts.length ? `${alerts.length} open, judged on the last 24 hours` : "Judged on the last 24 hours"} flush>
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
  // Measured on this page load, so these two never lag behind like analytics can.
  const checks = [
    { name: "Database", ok: db.ok, value: db.ok ? `${db.ms} ms` : "Not responding", slow: db.ok && db.ms > 800 },
    { name: "File storage", ok: storage.ok, value: storage.ok ? `${storage.ms} ms` : "Failing", slow: storage.ok && storage.ms > 1500 },
  ];
  const checksCard = (
    <Panel title="Live checks" aside="measured just now">
      <ul className="divide-y divide-cx-line">
        {checks.map((c) => (
          <li key={c.name} className="flex items-center gap-3 px-5 py-3">
            <span className={`h-2 w-2 shrink-0 rounded-full ${!c.ok ? "bg-cx-bad" : c.slow ? "bg-cx-warn" : "bg-cx-ok"}`} />
            <span className="flex-1 text-[14px] text-cx-text">{c.name}</span>
            <span className={`text-[14px] tabular-nums ${c.ok ? "text-cx-text-2" : "font-medium text-cx-bad"}`}>{c.value}</span>
          </li>
        ))}
      </ul>
    </Panel>
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

  const header = (
    <ZoneHeader title="Platform health" sub="Every institution portal and the console">
      {t && <span className="text-[13px] tabular-nums text-cx-muted">{spanLabel(t.since, range)}</span>}
      {configured && <RangeTabs base="/console/health" value={range} />}
    </ZoneHeader>
  );

  if (!t) {
    return (
      <div>
        {header}
        <Banner alerts={alerts} configured={false} />
        <div className={kpiStrip}>
          <Kpi label="Database" value={db.ok ? `${db.ms} ms` : "Not responding"} sub="round trip, measured now" />
          <Kpi label="File storage" value={storage.ok ? `${storage.ms} ms` : "Failing"} sub={storage.ok ? "photos and documents" : "uploads will fail"} />
          <Kpi label="Next exam rush" value={days[0] ? day(days[0].date) : "None scheduled"} sub={days[0] ? `${n(days[0].students)} students in ${days[0].institutions.length} institutions` : "next 45 days"} />
          <Kpi label="Portals watched" value={tenants.length + 1} sub="institutions and the console" />
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-2">{alertsCard}{busyCard}</div>
      </div>
    );
  }

  // ---- figures for this window
  const tot = { requests: 0, errors: 0, bytes: 0, visits: 0 };
  for (const h of t.hours) { tot.requests += h.requests; tot.errors += h.errors; tot.bytes += h.bytes; tot.visits += h.visits; }
  const vs = `previous ${R.label}`;
  const change = (k: keyof typeof tot, goodWhenDown?: boolean): Change =>
    t.prev && t.prev[k] > 0 ? { pct: (100 * (tot[k] - t.prev[k])) / t.prev[k], vs, goodWhenDown } : null;
  const peak = t.hours.reduce((a, h) => (h.requests > a.requests ? h : a), t.hours[0]);
  // Real portals first; every other name (port probes, made-up subdomains) folds into one row.
  const known = t.hosts.filter((h) => nameOfHost.has(h.host));
  const stray = t.hosts.filter((h) => !nameOfHost.has(h.host));
  const hostRows: Row[] = [...known];
  if (stray.length) hostRows.push({ host: "~stray", requests: stray.reduce((s, h) => s + h.requests, 0), errors: stray.reduce((s, h) => s + h.errors, 0), stray: stray.map((h) => h.host) });
  const top = known[0];
  const worstHost = [...known].sort((a, b) => b.errors - a.errors)[0];
  const label = (host: string) => nameOfHost.get(host) ?? host;
  const okPct = tot.requests ? (100 * (tot.requests - tot.errors)) / tot.requests : 100;
  const hasLatency = t.hours.some((h) => h.p99 != null);
  const latest = [...t.hours].reverse().find((h) => h.p50 != null);
  const per = R.bucket === "hour" ? "per hour" : R.bucket === "day" ? "per day" : "every 5 minutes";
  const series = (k: "requests" | "errors" | "bytes" | "visits" | "p99") => t.hours.map((h) => ({ hour: h.hour, value: h[k] }));
  const reqChange = change("requests");
  const updated = new Date(t.fetchedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });

  return (
    <div>
      {header}
      <Banner alerts={alerts} configured />

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel title="Summary" aside={`Updated ${updated}`}>
            <ul className="grid gap-x-8 px-5 py-2 md:grid-cols-2">
              <Fact icon="pulse">Portals answered <b>{n(tot.requests)}</b> requests across <b>{n(tot.visits)}</b> visits.</Fact>
              {reqChange
                ? <Fact icon={reqChange.pct >= 0 ? "arrow-up" : "arrow-down"}>That is <b>{Math.abs(reqChange.pct).toFixed(1)}% {reqChange.pct >= 0 ? "more" : "less"}</b> than the {vs}.</Fact>
                : <Fact icon="info">No earlier {R.label} on record to compare with yet.</Fact>}
              <Fact icon="admins"><b>{okPct.toFixed(2)}%</b> of requests were answered without a server error.</Fact>
              {top && <Fact icon="institution"><b>{label(top.host)}</b> was the busiest portal with <b>{n(top.requests)}</b> requests.</Fact>}
              {peak.requests > 0 && <Fact icon="attendance">The busiest {R.bucket} was <b>{when(peak.hour, R.bucket)}</b> with <b>{n(peak.requests)}</b> requests.</Fact>}
              {worstHost && worstHost.errors > 0
                ? <Fact icon="alert"><b>{n(tot.errors)}</b> server error{tot.errors === 1 ? "" : "s"}, most of them on <b>{label(worstHost.host)}</b> ({n(worstHost.errors)}).</Fact>
                : <Fact icon="alert">No server errors in the {R.long}.</Fact>}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4">
          {checksCard}
          {hasLatency && (
            <div className={kpiStrip + " !mb-0"}>
              <Kpi label="Typical page" value={ms(latest?.p50)} sub="half are faster" />
              <Kpi label="Slowest 1%" value={ms(latest?.p99)} sub={`latest ${R.bucket}`} />
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel title="Trends" aside={per.charAt(0).toUpperCase() + per.slice(1)}>
            <div className="divide-y divide-cx-line">
              <TrendRow label="Requests" value={n(tot.requests)} change={reqChange}>
                <HourlyLine data={series("requests")} scale={range} label="requests" height={150} />
              </TrendRow>
              <TrendRow label="Visits" value={n(tot.visits)} change={change("visits")}>
                <HourlyLine data={series("visits")} scale={range} label="visits" height={150} />
              </TrendRow>
              <TrendRow label="Server errors" value={n(tot.errors)} change={change("errors", true)}>
                <HourlyLine data={series("errors")} scale={range} label="errors" height={150} />
              </TrendRow>
              <TrendRow label="Data served" value={size(tot.bytes)} change={change("bytes")}>
                <HourlyLine data={series("bytes")} unit="bytes" scale={range} label="served" height={150} />
              </TrendRow>
              {hasLatency && (
                <TrendRow label="Slowest 1% of pages" value={ms(latest?.p99)} change={null}>
                  <HourlyLine data={series("p99")} unit="ms" scale={range} label="for the slowest 1%" height={150} />
                </TrendRow>
              )}
            </div>
          </Panel>
        </div>
        <div className="space-y-4">
          {alertsCard}
          {busyCard}
        </div>
      </div>

      <Section title="Traffic by address" desc={`Which portal the load and the errors come from, ${R.long}. Open one for its full breakdown`} flush>
        <ConsoleTable bare columns={hostCols} rows={hostRows} rowKey={(h) => h.host} empty="No traffic recorded" />
      </Section>
    </div>
  );
}
