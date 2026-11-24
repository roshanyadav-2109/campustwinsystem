import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell, NavLabel, PanelTitle } from "@/components/console/shell";
import { PanelLink } from "@/components/console/nav-link";
import { Crumbs } from "@/components/console/crumbs";
import { Dot } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

const ZONES: Record<string, string> = {
  students: "Students", staff: "Staff", guardians: "Guardians", access: "Login access",
  classes: "Classes and sections", attendance: "Attendance", exams: "Exams and marks",
  fees: "Fees", admissions: "Admissions", transport: "Transport", library: "Library",
  announcements: "Announcements", settings: "Settings",
};
const GROUPS: { label: string; items: string[] }[] = [
  { label: "People", items: ["students", "staff", "guardians", "access"] },
  { label: "Academics", items: ["classes", "attendance", "exams"] },
  { label: "Operations", items: ["fees", "admissions", "transport", "library", "announcements"] },
  { label: "Administration", items: ["settings"] },
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
          <PanelLink href={base} exact label="Overview" />
          {GROUPS.map((g) => (
            <div key={g.label}>
              <NavLabel>{g.label}</NavLabel>
              {g.items.map((seg) => <PanelLink key={seg} href={`${base}/${seg}`} label={ZONES[seg]} />)}
            </div>
          ))}
        </>
      }
    >
      {children}
    </Shell>
  );
}
