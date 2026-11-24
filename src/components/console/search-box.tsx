"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./icons";

// Global search in the top bar. "/" focuses it from anywhere, like AWS and Google Admin.
export function SearchBox() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form action="/console" method="get" className="relative w-full max-w-[520px]">
      <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/50" />
      <input
        ref={ref}
        name="q"
        placeholder="Search institutions"
        className="h-8 w-full rounded-md border border-white/15 bg-white/[0.08] pl-8 pr-9 text-[13px] text-white outline-none transition-colors placeholder:text-white/45 focus:border-white/40 focus:bg-white/[0.12]"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/20 px-1.5 font-mono text-[11px] leading-4 text-white/55">/</kbd>
    </form>
  );
}
