// Column chart for counts over time. One hue, values printed, a baseline rule.
export function ColumnBars({ data, height = 180 }: { data: { label: string; value: number }[]; height?: number; unit?: string }) {
  if (data.length === 0) return <p className="px-5 py-10 text-center text-[13px] text-cx-muted">No data yet</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="px-5 pb-4 pt-5">
      <div className="flex items-end gap-2 border-b border-cx-line-strong" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <span className="mb-1 text-[11.5px] tabular-nums text-cx-text-2">{d.value.toLocaleString("en-IN")}</span>
            <span className="w-full max-w-10 rounded-t-[4px] bg-[#0b57d0]" style={{ height: `${Math.max(2, (d.value / max) * (height - 22))}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {data.map((d) => <span key={d.label} className="min-w-0 flex-1 truncate text-center text-[11.5px] text-cx-muted">{d.label}</span>)}
      </div>
    </div>
  );
}
