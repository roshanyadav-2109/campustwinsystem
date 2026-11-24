import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell, PanelTitle } from "@/components/console/shell";
import { PanelLink, NavGroup } from "@/components/console/nav-link";
import { Crumbs } from "@/components/console/crumbs";
import { Dot } from "@/components/console/ui";
import type { IconName } from "@/components/console/icons";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

const ZONES: Record<string, string> = {
  students: "Students", staff: "Staff", guardians: "Guardians", access: "Login access",
  classes: "Classes and sections", attendance: "Attendance", exams: "Exams and marks",
  fees: "Fees", admissions: "Admissions", transport: "Transport", library: "Library",
  announcements: "Announcements", settings: "Settings",
};
const GROUPS: { id: string; label: string; icon: IconName; items: string[] }[] = [
  { id: "people", label: "People", icon: "team", items: ["students", "staff", "guardians", "access"] },
  { id: "academics", label: "Academics", icon: "students", items: ["classes", "attendance", "exams"] },
  { id: "operations", label: "Operations", icon: "briefcase", items: ["fees", "admissions", "transport", "library", "announcements"] },
];

export default async function SchoolWorkspaceLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: s } = await admin.from("school").select("id, name, slug, status, university_id").eq("id", Number(id)).maybeSingle();
  if (!s) notFound();
  const { data: uni } = s.university_id
    ? await admin.from("university").select("id, name").eq("id", s.university_id).maybeSingle()
    : { data: null };
  const base = `/console/school/${s.id}`;
  const trail = [
    { label: "Institutions", href: "/console/institutions" },
    ...(uni ? [{ label: uni.name, href: `/console/university/${uni.id}` }] : []),
    { label: s.name, href: base },
  ];

  return (
    <Shell
      crumbs={<Crumbs trail={trail} base={base} zones={ZONES} />}
      panel={
        <>
          <PanelTitle
            title={s.name}
            sub={<span className="flex items-center gap-1.5 font-mono"><Dot tone={s.status === "active" ? "ok" : "warn"} />{s.slug}.{BASE}</span>}
          />
          <div className="space-y-0.5">
            <PanelLink href={base} exact icon="overview" label="Overview" />
            {GROUPS.map((g) => (
              <NavGroup key={g.id} id={`school-${g.id}`} label={g.label} icon={g.icon} hrefs={g.items.map((seg) => `${base}/${seg}`)}>
                {g.items.map((seg) => <PanelLink key={seg} sub href={`${base}/${seg}`} label={ZONES[seg]} />)}
              </NavGroup>
            ))}
            <div className="pt-1"><PanelLink href={`${base}/settings`} icon="settings" label="Settings" /></div>
          </div>
        </>
      }
    >
      {children}
    </Shell>
  );
}
