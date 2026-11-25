"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Console chart tokens (Recharts needs concrete values). One series hue, validated
// against the card surface with the dataviz palette checker.
const SERIES = "#0b57d0";
const GRID = "#ececee";
const TICK = "#71717a";

const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

type Point = { start: string; end: string; rate: number };

function Tip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-cx-line bg-cx-card px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      <p className="text-[12px] text-cx-muted">{short(p.start)} to {short(p.end)}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-cx-text">{p.rate.toFixed(1)}%</p>
    </div>
  );
}

// Weekly attendance rate. Single series, so no legend: the panel title names it.
export function AttendanceTrend({ data }: { data: Point[] }) {
  const min = Math.min(...data.map((d) => d.rate));
  const floor = Math.max(0, Math.floor((min - 4) / 5) * 5);
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="cx-att" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.12} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="start" tickFormatter={short} tick={{ fill: TICK, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} dy={6} />
          <YAxis domain={[floor, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: TICK, fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<Tip />} cursor={{ stroke: "#d4d4d8", strokeWidth: 1 }} />
          <Area type="monotone" dataKey="rate" stroke={SERIES} strokeWidth={2} fill="url(#cx-att)" dot={false} activeDot={{ r: 4, fill: SERIES, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- time series
// One metric per bucket (5 minutes, an hour or a day, depending on the window).
// Buckets with no data leave a gap. Times are shown in IST; daily buckets are dates.
type HourPoint = { hour: string; value: number | null };
type Scale = "5h" | "24h" | "7d" | "30d";
type Unit = "count" | "ms" | "bytes";
const IST = "Asia/Kolkata";
const isDate = (s: string) => s.length === 10;
const at = (s: string) => new Date(isDate(s) ? s + "T00:00:00Z" : s);
const tickFor = (scale: Scale) => (s: string) =>
  scale === "5h" ? at(s).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST })
  : scale === "24h" ? at(s).toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST })
  : at(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: isDate(s) ? "UTC" : IST });
const whenFor = (scale: Scale, s: string) =>
  isDate(s) ? at(s).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
  : at(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", ...(scale === "5h" ? { minute: "2-digit" } : {}), hour12: true, timeZone: IST });
const fmtVal = (v: number, unit: Unit) =>
  unit === "ms" ? (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`)
  : unit === "bytes" ? (v >= 1e9 ? `${(v / 1e9).toFixed(1)} GB` : v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} MB` : v >= 1e3 ? `${Math.round(v / 1e3)} KB` : `${v} B`)
  : v.toLocaleString("en-IN");

function HourTip({ active, payload, unit, scale, label: what }: { active?: boolean; payload?: { payload: HourPoint }[]; unit: Unit; scale: Scale; label: string }) {
  if (!active || !payload?.length || payload[0].payload.value == null) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-cx-line bg-cx-card px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      <p className="text-[12px] text-cx-muted">{whenFor(scale, p.hour)}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-cx-text">{fmtVal(p.value!, unit)} <span className="text-[12px] font-normal text-cx-muted">{what}</span></p>
    </div>
  );
}

export function HourlyLine({ data, unit = "count", scale = "24h", label, height = 240 }: { data: HourPoint[]; unit?: Unit; scale?: Scale; label: string; height?: number }) {
  const id = `cx-h-${unit}-${label.replace(/W/g, "")}`;
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.12} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="hour" tickFormatter={tickFor(scale)} tick={{ fill: TICK, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={scale === "5h" ? 40 : 28} dy={6} />
          <YAxis tickFormatter={(v: number) => (unit === "count" && v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : fmtVal(v, unit))} tick={{ fill: TICK, fontSize: 12 }} tickLine={false} axisLine={false} width={unit === "bytes" ? 64 : 56} allowDecimals={false} />
          <Tooltip content={<HourTip unit={unit} scale={scale} label={label} />} cursor={{ stroke: "#d4d4d8", strokeWidth: 1 }} />
          <Area type={scale === "30d" ? "linear" : "monotone"} dataKey="value" stroke={SERIES} strokeWidth={scale === "7d" ? 1.5 : 2} fill={`url(#${id})`} dot={false} connectNulls={false} activeDot={{ r: 4, fill: SERIES, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
