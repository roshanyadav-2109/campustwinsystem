import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell, NavLabel } from "@/components/console/shell";
import { ConsoleNavLink } from "@/components/console/nav-link";
import { Crumbs } from "@/components/console/crumbs";
import { Icon, type IconName } from "@/components/console/icons";
import { Dot } from "@/components/console/ui";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

const ZONES: Record<string, string> = {
  students: "Students", staff: "Staff", guardians: "Guardians", access: "Login access",
  classes: "Classes and sections", attendance: "Attendance", exams: "Exams and marks",
  fees: "Fees", admissions: "Admissions", transport: "Transport", library: "Library",
  announcements: "Announcements", settings: "Settings",
};
const GROUPS: { label: string; items: [string, IconName][] }[] = [
  { label: "People", items: [["students", "students"], ["staff", "staff"], ["guardians", "guardians"], ["access", "access"]] },
  { label: "Academics", items: [["classes", "classes"], ["attendance", "attendance"], ["exams", "exams"]] },
  { label: "Operations", items: [["fees", "fees"], ["admissions", "admissions"], ["transport", "transport"], ["library", "library"], ["announcements", "announcements"]] },
  { label: "Administration", items: [["settings", "settings"]] },
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
  const back = uni ? { href: `/console/university/${uni.id}`, label: uni.name } : { href: "/console", label: "All institutions" };

  const brand = (
    <div className="px-3 py-3">
      <Link href={back.href} className="inline-flex items-center gap-1 text-[12px] text-cx-muted transition-colors hover:text-cx-text">
        <Icon name="chevron-left" size={12} />{back.label}
      </Link>
      <p className="mt-1.5 line-clamp-2 text-[14px] font-semibold leading-5 text-cx-text" title={s.name}>{s.name}</p>
      <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11.5px] text-cx-muted">
        <Dot tone={s.status === "active" ? "ok" : "warn"} />{s.slug}.{BASE}
      </p>
    </div>
  );

  const trail = [{ label: "Console", href: "/console" }, ...(uni ? [{ label: uni.name, href: `/console/university/${uni.id}` }] : []), { label: s.name, href: base }];

  return (
    <Shell
      brand={brand}
      crumbs={<Crumbs trail={trail} base={base} zones={ZONES} />}
      nav={
        <>
          <ConsoleNavLink href={base} exact icon={<Icon name="overview" size={18} />} label="Overview" />
          {GROUPS.map((g) => (
            <div key={g.label}>
              <NavLabel>{g.label}</NavLabel>
              {g.items.map(([seg, icon]) => (
                <ConsoleNavLink key={seg} href={`${base}/${seg}`} icon={<Icon name={icon} size={18} />} label={ZONES[seg]} />
              ))}
            </div>
          ))}
        </>
      }
    >
      {children}
    </Shell>
  );
}
