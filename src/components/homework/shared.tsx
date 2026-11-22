import { StatusPill, type Status } from "@/components/ui/status";

// Small pieces shared by the homework screens (server and client).

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const stampFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

// "2026-02-26" -> "26 Feb 2026"
export function fmtDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dayFmt.format(d);
}

// A timestamp, shown as the school-time day it fell on.
export function fmtStamp(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : stampFmt.format(d);
}

// 8 -> "8", 7.5 -> "7.5"
export function fmtMarks(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export type SubmissionState = "none" | "submitted" | "late" | "checked";

export function submissionState(s: { is_late: boolean; checked_at: string | null } | null | undefined): SubmissionState {
  if (!s) return "none";
  if (s.checked_at) return "checked";
  return s.is_late ? "late" : "submitted";
}

const stateLabel: Record<SubmissionState, string> = { none: "Not submitted", submitted: "Submitted", late: "Late", checked: "Checked" };
const stateTone: Record<SubmissionState, Status> = { none: "flat", submitted: "up", late: "watch", checked: "up" };

export function SubmissionStatus({ state }: { state: SubmissionState }) {
  return <StatusPill status={stateTone[state]}>{stateLabel[state]}</StatusPill>;
}

// Links are stored only when they start with https://; checked again here so
// nothing else is ever put in an href.
export function OutLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href || !href.startsWith("https://")) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-[#0F6CBD] hover:underline">
      {children}
    </a>
  );
}
