// Meter list: a name, a bar and a figure per row, bars on one baseline.
// Every value is printed, so colour never carries the reading alone.
export function MeterList({ rows, max, format, marker, markerLabel, labelWidth = 64 }: {
  rows: { label: string; value: number }[];
  max: number;
  format: (v: number) => string;
  marker?: number;
  markerLabel?: string;
  labelWidth?: number;
}) {
  if (rows.length === 0) return <p className="px-5 py-6 text-[13px] text-cx-muted">No data yet</p>;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="px-5 py-4">
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="grid items-center gap-3 text-[13px]" style={{ gridTemplateColumns: `minmax(0,${labelWidth}px) 1fr 56px` }}>
            <span className="truncate text-cx-text-2">{r.label}</span>
            <span className="relative h-2 rounded-full bg-cx-raised">
              <span className="absolute inset-y-0 left-0 rounded-full bg-[#0b57d0]" style={{ width: pct(r.value) }} />
              {marker !== undefined && <span aria-hidden className="absolute -inset-y-1 w-px bg-cx-text" style={{ left: pct(marker) }} />}
            </span>
            <span className="text-right tabular-nums text-cx-text">{format(r.value)}</span>
          </li>
        ))}
      </ul>
      {marker !== undefined && markerLabel && (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-cx-muted"><span aria-hidden className="h-3 w-px bg-cx-text" />{markerLabel}</p>
      )}
    </div>
  );
}
