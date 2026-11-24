"use client";
import { usePathname } from "next/navigation";
import { PanelLink } from "./nav-link";

type Item = { href: string; name: string; status: string };

function Label({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 pt-5 text-[12.5px] text-cx-muted">{children}</p>;
}
function Title({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 px-3 pt-1 text-[15px] font-semibold leading-5 text-cx-text">{children}</p>;
}
const dot = (s: string) => (s === "active" ? "ok" : "warn") as "ok" | "warn";

export function PlatformPanel({ universities, schools }: { universities: Item[]; schools: Item[] }) {
  const p = usePathname();

  if (p.startsWith("/console/owners")) {
    return (
      <>
        <Title>Team</Title>
        <PanelLink href="/console/owners" label="Console access" />
      </>
    );
  }

  if (p.startsWith("/console/institutions") || p.startsWith("/console/new")) {
    return (
      <>
        <Title>Institutions</Title>
        <PanelLink href="/console/institutions" label="All institutions" meta={String(universities.length + schools.length)} />
        <PanelLink href="/console/new" label="New institution" />
        {universities.length > 0 && <Label>Universities</Label>}
        {universities.map((u) => <PanelLink key={u.href} href={u.href} label={u.name} dot={dot(u.status)} />)}
        {schools.length > 0 && <Label>Schools</Label>}
        {schools.map((s) => <PanelLink key={s.href} href={s.href} label={s.name} dot={dot(s.status)} />)}
      </>
    );
  }

  return (
    <>
      <Title>Home</Title>
      <PanelLink href="/console" exact label="Dashboard" />
      <Label>Your institutions</Label>
      {[...universities, ...schools].map((i) => <PanelLink key={i.href} href={i.href} label={i.name} dot={dot(i.status)} />)}
    </>
  );
}
