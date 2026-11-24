import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell, NavLabel, PanelTitle } from "@/components/console/shell";
import { PanelLink } from "@/components/console/nav-link";
import { Crumbs } from "@/components/console/crumbs";
import { Dot } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const ZONES = { campuses: "Campuses", admins: "Central admins", settings: "Settings" };

export default async function UniversityWorkspaceLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: u } = await admin.from("university").select("id, name, slug, status").eq("id", Number(id)).maybeSingle();
  if (!u) notFound();
  const { data: campuses } = await admin.from("school").select("id, name, status").eq("university_id", u.id).order("name");
  const base = `/console/university/${u.id}`;

  return (
    <Shell
      crumbs={<Crumbs trail={[{ label: "Institutions", href: "/console/institutions" }, { label: u.name, href: base }]} base={base} zones={ZONES} />}
      panel={
        <>
          <PanelTitle
            title={u.name}
            sub={<span className="flex items-center gap-1.5 font-mono"><Dot tone={u.status === "active" ? "ok" : "warn"} />{u.slug}.{BASE}</span>}
          />
          <PanelLink href={base} exact label="Overview" />
          <NavLabel>University</NavLabel>
          <PanelLink href={`${base}/campuses`} label="Campuses" meta={String(campuses?.length ?? 0)} />
          <PanelLink href={`${base}/admins`} label="Central admins" />
          <PanelLink href={`${base}/settings`} label="Settings" />
          {(campuses?.length ?? 0) > 0 && <NavLabel>Open a campus</NavLabel>}
          {(campuses ?? []).map((c) => <PanelLink key={c.id} href={`/console/school/${c.id}`} label={c.name} dot={c.status === "active" ? "ok" : "warn"} />)}
        </>
      }
    >
      {children}
    </Shell>
  );
}
