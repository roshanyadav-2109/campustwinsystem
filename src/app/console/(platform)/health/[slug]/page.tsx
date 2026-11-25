import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsConfigured, hostDetail, parseRange, RANGES, type Count } from "@/lib/console/health";
import { ZoneHeader, Kpi, kpiStrip, ConsoleTable, type Col } from "@/components/console/table";
import { Section, EmptyState, btnGhost } from "@/components/console/ui";
import { HourlyLine } from "@/components/console/charts";
import { MeterList } from "@/components/console/meter-list";
import { Icon } from "@/components/console/icons";
import { RangeTabs } from "@/components/console/range-tabs";

export const dynamic = "force-dynamic";
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const n = (v: number) => v.toLocaleString("en-IN");
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const region = new Intl.DisplayNames(["en"], { type: "region" });
const country = (c: string) => { try { return c && c !== "XX" ? region.of(c) ?? c : "Unknown"; } catch { return c; } };
const AUTOMATED = /headless|curl|bot|spider|crawl|python|wget|go-http/i;
const browser = (b: string) => (AUTOMATED.test(b) ? `Automated (${b})` : b === "Unknown" ? "Not identified" : b);
const device = (d: string) => ({ desktop: "Desktop", mobile: "Mobile", tablet: "Tablet" } as Record<string, string>)[d] ?? "Other";
const STATUS_GROUPS: [string, (c: number) => boolean][] = [
  ["Success", (c) => c < 300],
  ["Redirected", (c) => c >= 300 && c < 400],
  ["Not found or not allowed", (c) => c >= 400 && c < 500],
  ["Server error", (c) => c >= 500],
];

export default async function HostHealth({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ range?: string }> }) {
  const { slug } = await params;
  const range = parseRange((await searchParams).range);
  const R = RANGES[range];
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  const host = `${slug}.${BASE}`;
  const admin = createAdminClient();
  const [{ data: school }, { data: uni }] = await Promise.all([
    admin.from("school").select("name").eq("slug", slug).maybeSingle(),
    admin.from("university").select("name").eq("slug", slug).maybeSingle(),
  ]);
  const name = slug === "console" ? "Console" : school?.name ?? uni?.name ?? host;

  if (!analyticsConfigured()) {
    return (
      <div>
        <ZoneHeader title={name} sub={host} />
        <EmptyState icon={<Icon name="pulse" size={22} />} title="Traffic analytics isn't connected" body="Add a read-only Cloudflare analytics token to the app to see who is using this portal, which pages they open and what fails." />
      </div>
    );
  }
  const d = await hostDetail(host, range);
  const per = R.bucket === "hour" ? "per hour" : R.bucket === "day" ? "per day" : "every 5 minutes";
  const statusRows = STATUS_GROUPS.map(([label, test]) => ({ label, value: d.statuses.filter((s) => test(Number(s.key))).reduce((t, s) => t + s.count, 0) })).filter((r) => r.value > 0);
  const cached = d.cache.find((c) => c.key === "hit")?.count ?? 0;
  const meter = (rows: Count[], label: (k: string) => string) => {
    const merged = new Map<string, number>();
    for (const r of rows) merged.set(label(r.key), (merged.get(label(r.key)) ?? 0) + r.count);
    return [...merged.entries()].sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l, value: v }));
  };
  const pageCols: Col<Count>[] = [
    { key: "p", label: "Page", render: (r) => <span className="font-mono text-[12.5px] text-cx-text">{r.key}</span> },
    { key: "c", label: "Requests", align: "right", render: (r) => n(r.count) },
  ];
  const failCols: Col<Count>[] = [
    { key: "p", label: "Page", render: (r) => <span className="font-mono text-[12.5px] text-cx-text">{r.key}</span> },
    { key: "c", label: "Errors", align: "right", render: (r) => <span className="font-medium text-cx-bad">{n(r.count)}</span> },
  ];

  return (
    <div>
      <ZoneHeader title={name} sub={`${host}, ${R.long}`}>
        <RangeTabs base={`/console/health/${slug}`} value={range} />
        <a href={`https://${host}`} target="_blank" rel="noreferrer" className={btnGhost}>Open <Icon name="external" size={14} /></a>
      </ZoneHeader>

      <div className={kpiStrip}>
        <Kpi label="Requests" value={n(d.requests)} />
        <Kpi label="Visits" value={n(d.visits)} sub="separate browsing sessions" />
        <Kpi label="Data served" value={size(d.bytes)} />
        <Kpi label="Server errors" value={n(d.errors)} sub={`${((100 * d.errors) / Math.max(1, d.requests)).toFixed(2)}% of requests`} />
        <Kpi label="Served from cache" value={`${Math.round((100 * cached) / Math.max(1, d.requests))}%`} sub="answered without running the app" />
      </div>

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title={`Requests ${per}`} flush>
            <div className="px-3 pb-3 pt-4"><HourlyLine data={d.hours} scale={range} label="requests" /></div>
          </Section>
        </div>
        <Section title="How requests ended" flush>
          <MeterList rows={statusRows} max={Math.max(1, d.requests)} format={n} />
        </Section>
      </div>

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title="Most opened pages" desc="Pages only, not the scripts and images they load" flush>
            <ConsoleTable bare columns={pageCols} rows={d.pages} rowKey={(r) => r.key} empty="No page views recorded" />
          </Section>
        </div>
        <Section title="Pages that failed" desc="Server errors by page" flush>
          <ConsoleTable bare columns={failCols} rows={d.failing} rowKey={(r) => r.key} empty={`No page failed in the ${R.long}`} />
        </Section>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Section title="Where visitors are" flush>
          <MeterList rows={meter(d.countries, country)} max={Math.max(1, d.requests)} format={n} />
        </Section>
        <Section title="Devices" flush>
          <MeterList rows={meter(d.devices, device)} max={Math.max(1, d.requests)} format={n} />
        </Section>
        <Section title="Browsers" desc="Automated means scripts or bots, not people" flush>
          <MeterList rows={meter(d.browsers, browser)} max={Math.max(1, d.requests)} format={n} />
        </Section>
      </div>
    </div>
  );
}
