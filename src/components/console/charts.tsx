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

// ---------------------------------------------------------------- hourly line
type HourPoint = { hour: string; value: number | null };
const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: "Asia/Kolkata" });
const fmtVal = (v: number, unit: "count" | "ms") => (unit === "ms" ? (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`) : v.toLocaleString("en-IN"));

function HourTip({ active, payload, unit, label: what }: { active?: boolean; payload?: { payload: HourPoint }[]; unit: "count" | "ms"; label: string }) {
  if (!active || !payload?.length || payload[0].payload.value == null) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-cx-line bg-cx-card px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      <p className="text-[12px] text-cx-muted">{new Date(p.hour).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", hour12: true, timeZone: "Asia/Kolkata" })}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-cx-text">{fmtVal(p.value!, unit)} <span className="text-[12px] font-normal text-cx-muted">{what}</span></p>
    </div>
  );
}

// One metric per hour for the last day. Hours with no data leave a gap.
export function HourlyLine({ data, unit = "count", label, height = 240 }: { data: HourPoint[]; unit?: "count" | "ms"; label: string; height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
          <defs>
            <linearGradient id={`cx-h-${unit}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.12} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="hour" tickFormatter={hourLabel} tick={{ fill: TICK, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={28} dy={6} />
          <YAxis tickFormatter={(v) => fmtVal(v, unit)} tick={{ fill: TICK, fontSize: 12 }} tickLine={false} axisLine={false} width={56} allowDecimals={false} />
          <Tooltip content={<HourTip unit={unit} label={label} />} cursor={{ stroke: "#d4d4d8", strokeWidth: 1 }} />
          <Area type="monotone" dataKey="value" stroke={SERIES} strokeWidth={2} fill={`url(#cx-h-${unit})`} dot={false} connectNulls={false} activeDot={{ r: 4, fill: SERIES, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
