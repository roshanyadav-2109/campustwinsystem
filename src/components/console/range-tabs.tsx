import Link from "@/components/ui/hover-link";
import { RANGES, type Range } from "@/lib/console/health";

// Segmented time-window switch. Plain links, so the window lives in the URL and
// a view can be shared or refreshed as is.
export function RangeTabs({ base, value }: { base: string; value: Range }) {
  return (
    <div role="tablist" aria-label="Time window" className="inline-flex rounded-md border border-cx-line-strong bg-cx-card p-0.5">
      {(Object.keys(RANGES) as Range[]).map((r) => {
        const on = r === value;
        return (
          <Link
            key={r}
            role="tab"
            aria-selected={on}
            href={r === "24h" ? base : `${base}?range=${r}`}
            scroll={false}
            className={`rounded-[5px] px-3 py-1 text-[13px] leading-5 ${on ? "bg-cx-sel font-medium text-cx-text" : "text-cx-text-2 hover:bg-cx-hover hover:text-cx-text"}`}
          >
            {RANGES[r].label}
          </Link>
        );
      })}
    </div>
  );
}
