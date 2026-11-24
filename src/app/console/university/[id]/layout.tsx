import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell, NavLabel } from "@/components/console/shell";
import { ConsoleNavLink } from "@/components/console/nav-link";
import { Crumbs } from "@/components/console/crumbs";
import { Icon } from "@/components/console/icons";
import { Dot } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const ZONES = { campuses: "Campuses", admins: "Central admins", settings: "Settings" };

export default async function UniversityWorkspaceLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: u } = await admin.from("university").select("id, name, slug, status").eq("id", Number(id)).maybeSingle();
  if (!u) notFound();
  const base = `/console/university/${u.id}`;

  const brand = (
    <div className="px-3 py-3">
      <Link href="/console" className="inline-flex items-center gap-1 text-[12px] text-cx-muted transition-colors hover:text-cx-text">
        <Icon name="chevron-left" size={12} />All institutions
      </Link>
      <p className="mt-1.5 line-clamp-2 text-[14px] font-semibold leading-5 text-cx-text" title={u.name}>{u.name}</p>
      <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11.5px] text-cx-muted">
        <Dot tone={u.status === "active" ? "ok" : "warn"} />{u.slug}.{BASE}
      </p>
    </div>
  );

  return (
    <Shell
      brand={brand}
      crumbs={<Crumbs trail={[{ label: "Console", href: "/console" }, { label: u.name, href: base }]} base={base} zones={ZONES} />}
      nav={
        <>
          <ConsoleNavLink href={base} exact icon={<Icon name="overview" size={18} />} label="Overview" />
          <NavLabel>University</NavLabel>
          <ConsoleNavLink href={`${base}/campuses`} icon={<Icon name="campuses" size={18} />} label="Campuses" />
          <ConsoleNavLink href={`${base}/admins`} icon={<Icon name="admins" size={18} />} label="Central admins" />
          <NavLabel>Administration</NavLabel>
          <ConsoleNavLink href={`${base}/settings`} icon={<Icon name="settings" size={18} />} label="Settings" />
        </>
      }
    >
      {children}
    </Shell>
  );
}
