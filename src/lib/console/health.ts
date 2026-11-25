import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// Platform health from Cloudflare's own request analytics (no extra infra, no
// extra cost) plus a live database round trip. Needs a READ-ONLY analytics token
// in the Worker secret CF_ANALYTICS_TOKEN; everything degrades gracefully without it.
const ACCOUNT = process.env.CF_ACCOUNT_ID || "47d2cf3b76f0dac7da00c97aedbe9b37";
const ZONE = process.env.CF_ZONE_ID || "2ae33e566eb46e85d85ba04882df6766";
const SCRIPT = process.env.CF_WORKER_NAME || "tsnms-erp";
// Marketing site and file CDN are separate services; health here is the ERP's.
const NOT_ERP = ["campustwin.org", "www.campustwin.org", "cdn.campustwin.org"];

export const analyticsConfigured = () => Boolean(process.env.CF_ANALYTICS_TOKEN);

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] | null };
  if (j.errors?.length || !j.data) throw new Error(j.errors?.[0]?.message ?? `Cloudflare analytics returned ${r.status}`);
  return j.data;
}

// Time windows, like a hosting panel's monitoring tab. Cloudflare keeps 31 days
// of request analytics and answers any window up to 30 days, so the bucket just
// grows with the window to keep each chart around 24 to 168 points.
export type Range = "5h" | "24h" | "7d" | "30d";
type Dim = "datetimeFiveMinutes" | "datetimeHour" | "date";
export const RANGES: Record<Range, { label: string; long: string; bucket: string; dim: Dim; step: number; count: number }> = {
  "5h": { label: "5 hours", long: "last 5 hours", bucket: "5 minutes", dim: "datetimeFiveMinutes", step: 300e3, count: 60 },
  "24h": { label: "24 hours", long: "last 24 hours", bucket: "hour", dim: "datetimeHour", step: 3600e3, count: 24 },
  "7d": { label: "7 days", long: "last 7 days", bucket: "hour", dim: "datetimeHour", step: 3600e3, count: 168 },
  "30d": { label: "30 days", long: "last 30 days", bucket: "day", dim: "date", step: 86400e3, count: 30 },
};
export const parseRange = (v: unknown): Range => (typeof v === "string" && v in RANGES ? (v as Range) : "24h");

// Bucket starts in the exact form Cloudflare returns them, oldest first.
function slotsFor(range: Range) {
  const { step, count, dim } = RANGES[range];
  const end = Math.floor(Date.now() / step) * step;
  const slots = Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * step).toISOString());
  const keys = slots.map((iso) => (dim === "date" ? iso.slice(0, 10) : iso.replace(".000Z", "Z")));
  return { keys, since: slots[0], until: new Date().toISOString() };
}

export type HourPoint = { hour: string; requests: number; errors: number; bytes: number; visits: number; p50: number | null; p99: number | null; cpu99: number | null };
export type HostRow = { host: string; requests: number; errors: number };
export type Totals = { requests: number; errors: number; bytes: number; visits: number };
// prev is the window of the same length just before this one; null when it falls outside what Cloudflare keeps.
export type Traffic = { range: Range; since: string; hours: HourPoint[]; hosts: HostRow[]; prev: Totals | null; fetchedAt: string };

type Group = { count: number; sum?: { edgeResponseBytes: number; visits: number }; dimensions: Record<string, string> };
type ZoneData = { viewer: { zones: { all: Group[]; errs: Group[]; hosts: Group[]; hostErrs: Group[]; prev?: Group[]; prevErr?: Group[] }[] } };
type WorkerRow = { sum: { requests: number; errors: number }; quantiles: { durationP50: number; durationP99: number; cpuTimeP99: number }; dimensions: Record<string, string> };
type WorkerData = { viewer: { accounts: { workersInvocationsAdaptive: WorkerRow[] }[] } };

export const platformTraffic = (range: Range = "24h") => unstable_cache(async (): Promise<Traffic> => {
  const { dim } = RANGES[range];
  const { keys, since, until } = slotsFor(range);
  const erp = { AND: [{ datetime_geq: since, datetime_leq: until }, ...NOT_ERP.map((h) => ({ clientRequestHTTPHost_neq: h }))] };
  const errOnly = { AND: [erp, { edgeResponseStatus_geq: 500 }] };
  const span = Date.now() - Date.parse(since); // same length as this window, so the comparison is fair
  const prevFrom = new Date(Date.parse(since) - span).toISOString();
  const hasPrev = Date.now() - Date.parse(prevFrom) < 30 * 86400e3; // Cloudflare keeps 31 days
  const before = { AND: [{ datetime_geq: prevFrom, datetime_lt: since }, ...NOT_ERP.map((h) => ({ clientRequestHTTPHost_neq: h }))] };

  const [zone, worker] = await Promise.all([
    gql<ZoneData>(
      `query($z:String!,$f:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!,$e:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!${hasPrev ? ",$p:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!,$pe:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!" : ""}){viewer{zones(filter:{zoneTag:$z}){
        ${hasPrev ? "prev:httpRequestsAdaptiveGroups(limit:1,filter:$p){count sum{edgeResponseBytes visits}} prevErr:httpRequestsAdaptiveGroups(limit:1,filter:$pe){count}" : ""}
        all:httpRequestsAdaptiveGroups(limit:500,filter:$f,orderBy:[${dim}_ASC]){count sum{edgeResponseBytes visits} dimensions{${dim}}}
        errs:httpRequestsAdaptiveGroups(limit:500,filter:$e,orderBy:[${dim}_ASC]){count dimensions{${dim}}}
        hosts:httpRequestsAdaptiveGroups(limit:100,filter:$f,orderBy:[count_DESC]){count dimensions{clientRequestHTTPHost}}
        hostErrs:httpRequestsAdaptiveGroups(limit:100,filter:$e,orderBy:[count_DESC]){count dimensions{clientRequestHTTPHost}}}}}`,
      { z: ZONE, f: erp, e: errOnly, ...(hasPrev ? { p: before, pe: { AND: [before, { edgeResponseStatus_geq: 500 }] } } : {}) },
    ),
    gql<WorkerData>(
      `query($a:String!,$s:Time!,$u:Time!,$w:String!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:1000,filter:{scriptName:$w,datetime_geq:$s,datetime_leq:$u},orderBy:[${dim}_ASC]){
        sum{requests errors} quantiles{durationP50 durationP99 cpuTimeP99} dimensions{${dim} status}}}}}`,
      { a: ACCOUNT, s: since, u: until, w: SCRIPT },
    ).catch(() => null), // response times need Account Analytics: Read; traffic still works without it
  ]);
  const z = zone.viewer.zones[0];
  const all = new Map(z.all.map((g) => [g.dimensions[dim], g]));
  const errs = new Map(z.errs.map((g) => [g.dimensions[dim], g.count]));
  const lat = new Map<string, { p50: number; p99: number; cpu99: number }>();
  for (const w of worker?.viewer.accounts[0]?.workersInvocationsAdaptive ?? []) {
    if (w.dimensions.status !== "success") continue;
    lat.set(w.dimensions[dim], { p50: Math.round(w.quantiles.durationP50 * 1000), p99: Math.round(w.quantiles.durationP99 * 1000), cpu99: Math.round(w.quantiles.cpuTimeP99 / 1000) });
  }
  const hours = keys.map((k) => {
    const g = all.get(k);
    return { hour: k, requests: g?.count ?? 0, errors: errs.get(k) ?? 0, bytes: g?.sum?.edgeResponseBytes ?? 0, visits: g?.sum?.visits ?? 0, p50: lat.get(k)?.p50 ?? null, p99: lat.get(k)?.p99 ?? null, cpu99: lat.get(k)?.cpu99 ?? null };
  });
  const hostErr = new Map(z.hostErrs.map((g) => [g.dimensions.clientRequestHTTPHost, g.count]));
  const hosts = z.hosts.map((g) => ({ host: g.dimensions.clientRequestHTTPHost, requests: g.count, errors: hostErr.get(g.dimensions.clientRequestHTTPHost) ?? 0 }));
  const p = z.prev?.[0];
  const prev = hasPrev ? { requests: p?.count ?? 0, errors: z.prevErr?.[0]?.count ?? 0, bytes: p?.sum?.edgeResponseBytes ?? 0, visits: p?.sum?.visits ?? 0 } : null;
  return { range, since, hours, hosts, prev, fetchedAt: new Date().toISOString() };
}, ["console-health-traffic-v3", range], { revalidate: 60 })();

// Live round trip from the app to the database: the number that rises first
// when the database is the bottleneck.
export async function databasePing(): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  try {
    const { error } = await createAdminClient().from("school").select("id", { count: "exact", head: true });
    return { ok: !error, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

// Exam days across every institution, so a platform-wide rush (everyone's exams
// or admit cards on the same day) is visible before it happens.
export async function busyDays(students: Map<number, number>, names: Map<number, string>) {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 45 * 86400e3).toISOString().slice(0, 10);
  const { data } = await admin.from("event").select("school_id, title, start_date").eq("event_type", "exam").gte("start_date", today).lte("start_date", horizon).limit(2000);
  const days = new Map<string, Set<number>>();
  for (const e of data ?? []) { const set = days.get(e.start_date) ?? new Set<number>(); set.add(e.school_id); days.set(e.start_date, set); }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, set]) => ({
    date,
    institutions: [...set].map((id) => names.get(id) ?? `#${id}`),
    students: [...set].reduce((t, id) => t + (students.get(id) ?? 0), 0),
  }));
}

export type Alert = { level: "outage" | "degraded" | "notice"; title: string; detail: string };

// Plain rules over the last hour and day. Thresholds are deliberately simple so
// every alert can be explained in one sentence.
export function evaluate(t: Traffic | null, db: { ok: boolean; ms: number }): Alert[] {
  const out: Alert[] = [];
  if (!db.ok) out.push({ level: "outage", title: "Database not responding", detail: "The app could not reach the database just now." });
  else if (db.ms > 800) out.push({ level: "degraded", title: "Database is slow", detail: `A simple query took ${db.ms} ms; it normally takes under 300 ms.` });
  if (!t) return out;
  const recent = [...t.hours].reverse().find((h) => h.requests >= 20) ?? t.hours[t.hours.length - 1];
  const rate = recent.requests ? recent.errors / recent.requests : 0;
  if (rate >= 0.1) out.push({ level: "outage", title: "Most requests are failing", detail: `${(rate * 100).toFixed(1)}% of requests returned a server error in the latest hour.` });
  else if (rate >= 0.01) out.push({ level: "degraded", title: "Raised error rate", detail: `${(rate * 100).toFixed(1)}% of requests returned a server error in the latest hour.` });
  if (recent.p99 != null && recent.p99 > 2000) out.push({ level: "degraded", title: "Slow responses", detail: `The slowest 1% of pages took ${(recent.p99 / 1000).toFixed(1)} s in the latest hour.` });
  const prior = t.hours.slice(0, -1).map((h) => h.requests).filter((n) => n > 0).sort((a, b) => a - b);
  const usual = prior.length ? prior[Math.floor(prior.length / 2)] : 0;
  const latest = t.hours[t.hours.length - 1].requests;
  if (usual > 0 && latest > 200 && latest > usual * 3) out.push({ level: "notice", title: "Traffic surge", detail: `This hour has ${(latest / usual).toFixed(1)} times the usual hourly traffic.` });
  for (const h of t.hosts) {
    if (h.errors >= 5 && h.errors / Math.max(1, h.requests) >= 0.02) out.push({ level: "notice", title: `Errors on ${h.host}`, detail: `${h.errors} server errors out of ${h.requests.toLocaleString("en-IN")} requests in the last 24 hours.` });
  }
  return out;
}

// ---------------------------------------------------------------- one address
export type Count = { key: string; count: number };
export type HostDetail = {
  host: string; requests: number; visits: number; bytes: number; errors: number;
  range: Range; hours: { hour: string; value: number }[];
  pages: Count[]; failing: Count[]; statuses: Count[]; countries: Count[]; devices: Count[]; browsers: Count[]; systems: Count[]; cache: Count[];
};
type G = { count: number; dimensions: Record<string, string | number> };

// Everything Cloudflare knows about one portal address over the chosen window.
export const hostDetail = (host: string, range: Range = "24h") =>
  unstable_cache(async (): Promise<HostDetail> => {
    const bucketDim = RANGES[range].dim;
    const { keys, since, until } = slotsFor(range);
    const f = { AND: [{ datetime_geq: since, datetime_leq: until }, { clientRequestHTTPHost: host }] };
    const e = { AND: [f, { edgeResponseStatus_geq: 500 }] };
    const dim = (alias: string, field: string, limit: number, filter = "$f") => `${alias}:httpRequestsAdaptiveGroups(limit:${limit},filter:${filter},orderBy:[count_DESC]){count dimensions{${field}}}`;
    const d = await gql<{ viewer: { zones: Record<string, G[] | { count: number; sum: { edgeResponseBytes: number; visits: number } }[]>[] } }>(
      `query($z:String!,$f:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!,$e:ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!){viewer{zones(filter:{zoneTag:$z}){
        hours:httpRequestsAdaptiveGroups(limit:500,filter:$f,orderBy:[${bucketDim}_ASC]){count dimensions{${bucketDim}}}
        totals:httpRequestsAdaptiveGroups(limit:1,filter:$f){count sum{edgeResponseBytes visits}}
        errTotal:httpRequestsAdaptiveGroups(limit:1,filter:$e){count}
        ${dim("pages", "clientRequestPath", 60)} ${dim("failing", "clientRequestPath", 15, "$e")} ${dim("statuses", "edgeResponseStatus", 20)}
        ${dim("countries", "clientCountryName", 10)} ${dim("devices", "clientDeviceType", 6)} ${dim("browsers", "userAgentBrowser", 10)}
        ${dim("systems", "userAgentOS", 8)} ${dim("cache", "cacheStatus", 8)}}}}`,
      { z: ZONE, f, e },
    );
    const z = d.viewer.zones[0] as Record<string, G[]>;
    const list = (k: string, field: string): Count[] => (z[k] ?? []).map((g) => ({ key: String(g.dimensions[field]), count: g.count }));
    const totals = (z.totals as unknown as { count: number; sum: { edgeResponseBytes: number; visits: number } }[])[0];
    const hourMap = new Map((z.hours ?? []).map((g) => [String(g.dimensions[bucketDim]), g.count]));
    // Pages people open, not the scripts and images the browser fetches for them.
    const isAsset = (p: string) => p.startsWith("/_next/") || p.startsWith("/cdn-cgi/") || /\.(js|css|png|jpe?g|webp|svg|ico|woff2?|txt|map)$/.test(p);
    return {
      host,
      range,
      requests: totals?.count ?? 0,
      visits: totals?.sum.visits ?? 0,
      bytes: totals?.sum.edgeResponseBytes ?? 0,
      errors: (z.errTotal?.[0]?.count as number | undefined) ?? 0,
      hours: keys.map((h) => ({ hour: h, value: hourMap.get(h) ?? 0 })),
      pages: list("pages", "clientRequestPath").filter((p) => !isAsset(p.key)).slice(0, 12),
      failing: list("failing", "clientRequestPath"),
      statuses: list("statuses", "edgeResponseStatus"),
      countries: list("countries", "clientCountryName"),
      devices: list("devices", "clientDeviceType"),
      browsers: list("browsers", "userAgentBrowser"),
      systems: list("systems", "userAgentOS"),
      cache: list("cache", "cacheStatus"),
    };
  }, ["console-health-host-v2", host, range], { revalidate: 60 })();

// Live check that the app can reach file storage with its own credentials, so a
// missing or revoked key shows up here before a school notices broken uploads.
export async function storagePing(): Promise<{ ok: boolean; ms: number; reason?: string }> {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return { ok: false, ms: 0, reason: "File storage credentials are not set on the app, so photo uploads and deletions fail." };
  const { AwsClient } = await import("aws4fetch");
  const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const t0 = Date.now();
  try {
    const r = await r2.fetch(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET || "campustwin-media"}?list-type=2&max-keys=1`);
    return r.ok ? { ok: true, ms: Date.now() - t0 } : { ok: false, ms: Date.now() - t0, reason: `File storage refused the app's credentials (HTTP ${r.status}).` };
  } catch {
    return { ok: false, ms: Date.now() - t0, reason: "File storage could not be reached." };
  }
}
