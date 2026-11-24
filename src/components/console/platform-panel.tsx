"use client";
import { usePathname } from "next/navigation";
import { PanelLink, NavGroup } from "./nav-link";

type Item = { href: string; name: string; status: string };
const dot = (s: string) => (s === "active" ? "ok" : "warn") as "ok" | "warn";

function Title({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 px-2 pt-1 text-[15px] font-semibold leading-5 text-cx-text">{children}</p>;
}

export function PlatformPanel({ universities, schools }: { universities: Item[]; schools: Item[] }) {
  const p = usePathname();
  const all = [...universities, ...schools];

  if (p.startsWith("/console/owners")) {
    return (
      <>
        <Title>Team</Title>
        <PanelLink href="/console/owners" icon="admins" label="Console access" />
      </>
    );
  }

  if (p.startsWith("/console/institutions") || p.startsWith("/console/new")) {
    return (
      <>
        <Title>Institutions</Title>
        <div className="space-y-0.5">
          <PanelLink href="/console/institutions" icon="institution" label="All institutions" meta={String(all.length)} />
          <PanelLink href="/console/new" icon="new" label="New institution" />
          {universities.length > 0 && (
            <NavGroup id="plat-unis" label="Universities" icon="campuses" hrefs={universities.map((u) => u.href)}>
              {universities.map((u) => <PanelLink key={u.href} sub href={u.href} label={u.name} dot={dot(u.status)} />)}
            </NavGroup>
          )}
          {schools.length > 0 && (
            <NavGroup id="plat-schools" label="Schools" icon="students" hrefs={schools.map((s) => s.href)}>
              {schools.map((s) => <PanelLink key={s.href} sub href={s.href} label={s.name} dot={dot(s.status)} />)}
            </NavGroup>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <Title>Home</Title>
      <div className="space-y-0.5">
        <PanelLink href="/console" exact icon="overview" label="Dashboard" />
        <NavGroup id="plat-home-inst" label="Your institutions" icon="institution" hrefs={all.map((i) => i.href)}>
          {all.map((i) => <PanelLink key={i.href} sub href={i.href} label={i.name} dot={dot(i.status)} />)}
        </NavGroup>
      </div>
    </>
  );
}
