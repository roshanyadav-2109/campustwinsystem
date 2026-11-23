"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SCHOOL } from "@/lib/school";

// The institution emblem. Pass the runtime brand (logo/monogram/name) on public
// pages and the signed-in shell; with nothing passed it falls back to the
// build-time SCHOOL defaults. Falls back to a typographic monogram if the image
// is missing.
export function SchoolEmblem({
  size = 40, className, logo, monogram, name,
}: { size?: number; className?: string; logo?: string; monogram?: string; name?: string }) {
  const src = logo ?? SCHOOL.logo;
  const label = name ?? SCHOOL.name;
  const mono = (monogram ?? SCHOOL.monogram).slice(0, 2).toUpperCase();
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${label} emblem`}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={cn("object-contain", className)}
      />
    );
  }
  return (
    <div
      aria-label={`${label} emblem placeholder`}
      title="School emblem slot"
      style={{ width: size, height: size }}
      className={cn(
        "flex items-center justify-center rounded-md border border-gold-500/50 bg-gold-100 text-gold-700",
        className,
      )}
    >
      <span className="font-bold tracking-tight" style={{ fontSize: size * 0.42 }}>
        {mono}
      </span>
    </div>
  );
}

export function BrandLockup({
  subtitle, name, place, logo, monogram,
}: { subtitle?: string; name?: string; place?: string; logo?: string; monogram?: string }) {
  return (
    <div className="flex items-center gap-3">
      <SchoolEmblem size={40} logo={logo} monogram={monogram} name={name} />
      <div className="leading-tight">
        <div className="text-[15px] font-bold text-ink-900">{name ?? SCHOOL.name}</div>
        <div className="text-[12px] text-ink-500">{subtitle ?? place ?? SCHOOL.place}</div>
      </div>
    </div>
  );
}
