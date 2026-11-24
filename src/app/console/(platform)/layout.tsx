import { Shell, NavLabel } from "@/components/console/shell";
import { ConsoleNavLink } from "@/components/console/nav-link";
import { Crumbs } from "@/components/console/crumbs";
import { Icon } from "@/components/console/icons";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const brand = (
    <div className="px-3 py-3">
      <p className="text-[14px] font-semibold leading-5 text-cx-text">Platform</p>
      <p className="text-[12px] text-cx-muted">Every institution on CampusTwin</p>
    </div>
  );
  return (
    <Shell
      brand={brand}
      crumbs={<Crumbs trail={[{ label: "Console", href: "/console" }]} base="/console" zones={{ new: "New institution", owners: "Team" }} />}
      nav={
        <>
          <NavLabel>Institutions</NavLabel>
          <ConsoleNavLink href="/console" exact icon={<Icon name="overview" size={18} />} label="Overview" />
          <ConsoleNavLink href="/console/new" icon={<Icon name="new" size={18} />} label="New institution" />
          <NavLabel>Company</NavLabel>
          <ConsoleNavLink href="/console/owners" icon={<Icon name="team" size={18} />} label="Team" />
        </>
      }
    >
      {children}
    </Shell>
  );
}
