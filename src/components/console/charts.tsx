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
      <p className="text-[12px] text-cx-muted">{short(p.start)} – {short(p.end)}</p>
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
