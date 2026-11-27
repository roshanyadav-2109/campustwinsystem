"use client";
import Link from "next/link";
import { useState, type ComponentProps } from "react";

// A link that loads its page in the background only when the pointer rests on
// it (or it gets keyboard focus), not as soon as it is on screen. The side menu
// and the home page list many pages; preloading all of them on every page view
// made the server build every one of them each time (Next.js docs: "prefetch
// only on hover").
export default function HoverLink({ onMouseEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const [active, setActive] = useState(false);
  return (
    <Link
      {...props}
      prefetch={active ? null : false}
      onMouseEnter={(e) => { setActive(true); onMouseEnter?.(e); }}
      onFocus={(e) => { setActive(true); onFocus?.(e); }}
      onTouchStart={(e) => { setActive(true); onTouchStart?.(e); }}
    />
  );
}
